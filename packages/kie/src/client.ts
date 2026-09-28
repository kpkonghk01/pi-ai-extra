import { z } from "zod";
import {
  codeForStatus,
  contextError,
  fileExtension,
  pollTask,
  requestJson,
  safeStringify,
  truncate,
  isPiAiExtraError,
  looksLikeContentBlock,
  type InlineReference,
  type OperationContext,
  type PollOutcome,
  type PollSchedule,
  type RetryPolicy,
} from "@hk01/pi-ai-extra-internal";

export interface KieEndpoints {
  apiBaseUrl: string;
  uploadBaseUrl: string;
}

const UPLOAD_TIMEOUT_MS = 60_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_RETRY: RetryPolicy = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000 };
const POLL_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000 };
const MAX_TRANSIENT_POLL_FAILURES = 3;

/** KIE wraps every response in `{ code, msg, data }`; `code` is authoritative even when HTTP is 200. */
const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), msg: z.string().nullish(), data: data.nullish() });

const uploadResponse = envelope(z.object({ downloadUrl: z.url() }));
const createTaskResponse = envelope(z.object({ taskId: z.string().min(1) }));
const recordInfoResponse = envelope(
  z.object({
    state: z.string(),
    resultJson: z.string().nullish(),
    failCode: z.union([z.string(), z.number()]).nullish(),
    failMsg: z.string().nullish(),
  }),
);
const resultJsonSchema = z.object({ resultUrls: z.array(z.url()).min(1) });

const PENDING_STATES = new Set(["waiting", "queuing", "generating"]);

/** Uploads one inline reference through KIE's base64 File Upload API and returns its URL. */
export async function uploadToKie(
  ctx: OperationContext,
  apiKey: string,
  endpoints: KieEndpoints,
  reference: InlineReference,
): Promise<string> {
  const body = JSON.stringify({
    base64Data: `data:${reference.mimeType};base64,${reference.base64}`,
    uploadPath: "pi-ai-extra/references",
    fileName: `ref-${Date.now()}-${reference.index}-${Math.random().toString(36).slice(2, 10)}.${fileExtension(reference.mimeType)}`,
  });
  const response = await requestJson(
    ctx,
    {
      url: `${endpoints.uploadBaseUrl}/api/file-base64-upload`,
      method: "POST",
      headers: jsonHeaders(apiKey),
      body,
      operation: "upload",
      timeoutMs: UPLOAD_TIMEOUT_MS,
      retry: UPLOAD_RETRY,
    },
    uploadResponse,
  );
  return envelopeData(ctx, response, "upload", `referenceImages[${reference.index}] upload`).downloadUrl;
}

/** Creates a KIE market task. Never retried automatically: a repeated submission could be billed twice. */
export async function createKieTask(
  ctx: OperationContext,
  apiKey: string,
  endpoints: KieEndpoints,
  model: string,
  input: Record<string, unknown>,
): Promise<string> {
  const response = await requestJson(
    ctx,
    {
      url: `${endpoints.apiBaseUrl}/api/v1/jobs/createTask`,
      method: "POST",
      headers: jsonHeaders(apiKey),
      body: JSON.stringify({ model, input }),
      operation: "submit",
      timeoutMs: SUBMIT_TIMEOUT_MS,
    },
    createTaskResponse,
  );
  return envelopeData(ctx, response, "submit", "createTask").taskId;
}

/** Polls `recordInfo` for the same task until success (result URLs) or failure. */
export async function waitForKieTask(
  ctx: OperationContext,
  apiKey: string,
  endpoints: KieEndpoints,
  taskId: string,
  schedule: PollSchedule,
): Promise<string[]> {
  let consecutiveTransientFailures = 0;
  return pollTask(ctx, {
    ...schedule,
    taskId,
    check: async () => {
      try {
        const outcome = await checkKieTask(ctx, apiKey, endpoints, taskId);
        consecutiveTransientFailures = 0;
        return outcome;
      } catch (error) {
        // Transient status-query failures (after HTTP-level retries) keep polling the same task, within a bound.
        if (isPiAiExtraError(error) && error.retryable && consecutiveTransientFailures < MAX_TRANSIENT_POLL_FAILURES) {
          consecutiveTransientFailures += 1;
          return { done: false, status: `status query failed (${error.code}); retrying` };
        }
        throw error;
      }
    },
  });
}

async function checkKieTask(
  ctx: OperationContext,
  apiKey: string,
  endpoints: KieEndpoints,
  taskId: string,
): Promise<PollOutcome<string[]>> {
  const response = await requestJson(
    ctx,
    {
      url: `${endpoints.apiBaseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      operation: "poll",
      taskId,
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      retry: POLL_RETRY,
    },
    recordInfoResponse,
  );
  const record = envelopeData(ctx, response, "poll", "recordInfo", taskId);

  if (PENDING_STATES.has(record.state)) return { done: false, status: record.state };
  if (record.state === "fail") {
    const failCode = record.failCode === null || record.failCode === undefined ? undefined : String(record.failCode);
    const failMsg = record.failMsg?.trim() || "KIE returned no failure message";
    throw contextError(ctx, `Task ${taskId} failed: ${failMsg}${failCode ? ` (failCode ${failCode})` : ""}.`, {
      code: looksLikeContentBlock(record.failMsg ?? undefined) ? "content_blocked" : "task_failed",
      operation: "poll",
      taskId,
      providerCode: failCode,
      responseBody: truncate(safeStringify(response)),
    });
  }
  if (record.state === "success") return { done: true, value: parseResultUrls(ctx, record.resultJson, taskId) };
  throw contextError(ctx, `Task ${taskId} returned unknown state ${JSON.stringify(record.state)}.`, {
    code: "invalid_response",
    operation: "poll",
    taskId,
    responseBody: truncate(safeStringify(response)),
  });
}

function parseResultUrls(ctx: OperationContext, resultJson: string | null | undefined, taskId: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson ?? "");
  } catch (error) {
    throw contextError(ctx, `Task ${taskId} succeeded but resultJson is not valid JSON.`, {
      code: "invalid_response",
      operation: "poll",
      taskId,
      responseBody: truncate(String(resultJson)),
      cause: error,
    });
  }
  const result = resultJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw contextError(ctx, `Task ${taskId} succeeded but resultJson has no resultUrls.`, {
      code: "invalid_response",
      operation: "poll",
      taskId,
      responseBody: truncate(String(resultJson)),
    });
  }
  return result.data.resultUrls;
}

function envelopeData<T>(
  ctx: OperationContext,
  response: { code: number; msg?: string | null | undefined; data?: T | null | undefined },
  operation: "upload" | "submit" | "poll",
  label: string,
  taskId?: string,
): T {
  if (response.code === 200 && response.data) return response.data;
  const code = response.code === 200 ? "invalid_response" : codeForStatus(response.code);
  const error = contextError(ctx, `${label} failed with KIE code ${response.code}: ${response.msg?.trim() || "no message"}.`, {
    code: operation === "upload" && code === "http" ? "upload_failed" : code,
    operation,
    taskId,
    providerCode: String(response.code),
    retryable: response.code === 429 || response.code >= 500,
    responseBody: truncate(safeStringify(response)),
  });
  throw error;
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}
