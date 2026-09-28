import type { z } from "zod";
import { abortedError, sleep } from "./abort.ts";
import { contextError, type OperationContext } from "./context.ts";
import { isPiAiExtraError, type PiAiExtraError, type PiAiExtraErrorCode, type PiAiExtraOperation } from "./errors.ts";
import { formatZodIssues } from "./validation.ts";

const RESPONSE_BODY_LIMIT = 2_000;

export interface RetryPolicy {
  /** Total attempts including the first one. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string> | undefined;
  body?: string | FormData | undefined;
  operation: PiAiExtraOperation;
  taskId?: string | undefined;
  timeoutMs: number;
  /**
   * Only for idempotent requests (status polls, downloads, uploads of the same bytes).
   * Retries hit the same URL of the same provider on network errors, timeouts, 429 and 5xx.
   */
  retry?: RetryPolicy | undefined;
}

export interface JsonResponse {
  status: number;
  body: unknown;
}

/** Sends one HTTP request (with same-endpoint retries when allowed) and returns the parsed JSON body. */
export async function sendJson(ctx: OperationContext, request: HttpRequest): Promise<JsonResponse> {
  const attempts = Math.max(1, request.retry?.attempts ?? 1);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sendJsonOnce(ctx, request);
    } catch (error) {
      if (!isPiAiExtraError(error) || !error.retryable || attempt >= attempts || !request.retry) throw error;
      const delay = retryDelayMs(request.retry, attempt, error);
      await sleep(ctx, delay, request.operation, request.taskId);
    }
  }
}

/** `sendJson` plus schema validation of the response body. */
export async function requestJson<T>(ctx: OperationContext, request: HttpRequest, schema: z.ZodType<T>): Promise<T> {
  const response = await sendJson(ctx, request);
  const parsed = schema.safeParse(response.body);
  if (parsed.success) return parsed.data;
  throw contextError(ctx, `Unexpected ${request.operation} response shape: ${formatZodIssues(parsed.error)}`, {
    code: "invalid_response",
    operation: request.operation,
    status: response.status,
    taskId: request.taskId,
    responseBody: truncate(safeStringify(response.body)),
  });
}

export interface OpenedResponse {
  response: Response;
  /** Converts a failure while reading the body (abort, timeout, reset) into a `PiAiExtraError`. */
  toError: (error: unknown) => PiAiExtraError;
}

/** Performs the fetch with the caller's signal plus a per-request timeout. Network failures become `PiAiExtraError`s. */
export async function openRequest(ctx: OperationContext, request: HttpRequest): Promise<OpenedResponse> {
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeoutSignal]) : timeoutSignal;
  const init: RequestInit = { method: request.method, signal };
  if (request.headers) init.headers = request.headers;
  if (request.body !== undefined) init.body = request.body;
  const toError = (error: unknown): PiAiExtraError => transportError(ctx, request, timeoutSignal, error);
  try {
    return { response: await ctx.fetch(request.url, init), toError };
  } catch (error) {
    throw toError(error);
  }
}

export function transportError(
  ctx: OperationContext,
  request: HttpRequest,
  timeoutSignal: AbortSignal,
  error: unknown,
): PiAiExtraError {
  if (isPiAiExtraError(error)) return error;
  if (ctx.signal?.aborted) return abortedError(ctx, request.operation, request.taskId);
  if (timeoutSignal.aborted) {
    return contextError(ctx, `${request.operation} request timed out after ${request.timeoutMs} ms (${describeUrl(request.url)}).`, {
      code: "timeout",
      operation: request.operation,
      taskId: request.taskId,
      retryable: true,
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return contextError(ctx, `${request.operation} request failed (${describeUrl(request.url)}): ${reason}`, {
    code: "network",
    operation: request.operation,
    taskId: request.taskId,
    retryable: true,
    cause: error,
  });
}

async function sendJsonOnce(ctx: OperationContext, request: HttpRequest): Promise<JsonResponse> {
  const { response, toError } = await openRequest(ctx, request);
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw toError(error);
  }

  const body = parseJsonText(text);
  if (!response.ok) throw httpStatusError(ctx, request, response, body, text);
  if (body === undefined) {
    throw contextError(ctx, `${request.operation} response is not valid JSON (HTTP ${response.status}).`, {
      code: "invalid_response",
      operation: request.operation,
      status: response.status,
      taskId: request.taskId,
      responseBody: truncate(text),
    });
  }
  return { status: response.status, body };
}

export function httpStatusError(
  ctx: OperationContext,
  request: HttpRequest,
  response: Response,
  body: unknown,
  text: string,
): PiAiExtraError {
  const status = response.status;
  const extracted = extractProviderMessage(body);
  const code = codeForStatus(status);
  const detail = extracted.message ?? (text.trim() ? truncate(text.trim(), 300) : response.statusText);
  const error = contextError(ctx, `${request.operation} failed with HTTP ${status}: ${detail}`, {
    code,
    operation: request.operation,
    status,
    taskId: request.taskId,
    providerCode: extracted.code,
    retryable: status === 429 || status === 408 || status >= 500,
    responseBody: truncate(text),
  });
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  if (retryAfter !== undefined) retryAfterByError.set(error, retryAfter);
  return error;
}

export function codeForStatus(status: number): PiAiExtraErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "insufficient_credits";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "invalid_request";
  return "http";
}

/**
 * Reads the provider's error message from the documented top-level fields only
 * (`message`, `msg`, `error`, `error.message`, `fail_reason`). No recursive scanning.
 */
export function extractProviderMessage(body: unknown): { message?: string; code?: string } {
  if (!isRecord(body)) return {};
  const nested = isRecord(body.error) ? body.error : undefined;
  const message =
    asNonEmptyString(nested?.message) ??
    asNonEmptyString(body.error) ??
    asNonEmptyString(body.message) ??
    asNonEmptyString(body.msg) ??
    asNonEmptyString(body.fail_reason);
  const code = asCode(nested?.code) ?? asCode(nested?.status) ?? asCode(body.code);
  const result: { message?: string; code?: string } = {};
  if (message !== undefined) result.message = message;
  if (code !== undefined) result.code = code;
  return result;
}

export function truncate(value: string, limit: number = RESPONSE_BODY_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}… (${value.length - limit} more characters)`;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Host and path only; query strings may carry task ids but never credentials, and are omitted for brevity. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "invalid URL";
  }
}

const retryAfterByError = new WeakMap<PiAiExtraError, number>();

function retryDelayMs(policy: RetryPolicy, attempt: number, error: PiAiExtraError): number {
  const requested = retryAfterByError.get(error);
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const delay = requested ?? exponential;
  return Math.min(policy.maxDelayMs, delay);
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function parseJsonText(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asCode(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
