import { z } from "zod";
import {
  compactUsage,
  contextError,
  decimalStringSchema,
  emitProgress,
  looksLikeContentBlock,
  parseUsageBlock,
  pollTask,
  requestJson,
  safeStringify,
  tokenCountSchema,
  truncate,
  type ImageUsage,
  type OperationContext,
  type PollSchedule,
  type RetryPolicy,
} from "@hk01/pi-ai-extra-internal";

export type ToapisTaskStatus = "pending" | "queued" | "in_progress" | "completed" | "failed";

/** One validated `GET /v1/images/generations/{taskId}` observation. */
export interface ToapisTaskRecord {
  taskId: string;
  model: string | undefined;
  status: ToapisTaskStatus;
  clientBusinessId: string | undefined;
  /** Present when `status` is `completed`. */
  resultUrls: string[] | undefined;
  errorCode: string | undefined;
  errorMessage: string | undefined;
  usage: ImageUsage | undefined;
}

const POLL_REQUEST_TIMEOUT_MS = 30_000;
const POLL_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 2_000, maxDelayMs: 30_000 };
const MAX_TRANSIENT_POLL_FAILURES = 3;
const STATUSES = ["pending", "queued", "in_progress", "completed", "failed"] as const;
const PENDING_STATUSES: ReadonlySet<string> = new Set(["pending", "queued", "in_progress"]);

/**
 * `poll`: strict (a completed task without valid result URLs fails the generation).
 * `lookup`: billing reconciliation; usage always parsed, and a missing/invalid result is
 * reported as a warning with `resultUrls: undefined` so the billing record is still returned.
 */
export type ToapisRecordMode = "poll" | "lookup";

const statusResponse = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  client_business_id: z.string().nullish(),
  status: z.string(),
  // Validated separately (see resultUrlsFor) so lookups can still return billing.
  result: z.unknown().optional(),
  error: z.object({ code: z.union([z.string(), z.number()]).nullish(), message: z.string().nullish() }).nullish(),
  fail_reason: z.string().nullish(),
  // Validated separately (see toapisUsage) so an accounting shape change cannot fail a finished task.
  billing: z.unknown().optional(),
  usage: z.unknown().optional(),
});

/** `billing` per ToAPIs "Get image task status": amounts are decimal strings, present only when settled/refunded. */
const billingSchema = z.object({
  status: z.enum(["pending", "settled", "refunded"]),
  credits: decimalStringSchema.optional(),
  cost_usd: decimalStringSchema.optional(),
});

const resultSchema = z.object({ data: z.array(z.object({ url: z.url() })).min(1) });

const tokenPair = z.object({ text_tokens: tokenCountSchema.optional(), image_tokens: tokenCountSchema.optional() });

/** Settled image token usage per ToAPIs "Get image task status" (`usage.*`). */
const usageSchema = z.object({
  input_tokens: tokenCountSchema.optional(),
  output_tokens: tokenCountSchema.optional(),
  total_tokens: tokenCountSchema.optional(),
  input_tokens_details: tokenPair
    .extend({ cached_tokens: tokenCountSchema.optional(), cached_tokens_details: tokenPair.optional() })
    .optional(),
  output_tokens_details: tokenPair.optional(),
});

/** Reads the task status once. */
export async function fetchToapisTaskRecord(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  taskId: string,
  mode: ToapisRecordMode,
  timeoutMs: number = POLL_REQUEST_TIMEOUT_MS,
): Promise<ToapisTaskRecord> {
  const response = await requestJson(
    ctx,
    {
      url: `${baseUrl}/v1/images/generations/${encodeURIComponent(taskId)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      operation: "poll",
      taskId,
      timeoutMs,
      retry: POLL_RETRY,
    },
    statusResponse,
  );
  const status = STATUSES.find((known) => known === response.status);
  if (!status) throw invalid(ctx, taskId, `returned unknown status ${JSON.stringify(response.status)}`, response);
  const resultUrls = status === "completed" ? resultUrlsFor(ctx, taskId, response, mode) : undefined;
  const errorCode = response.error?.code === null || response.error?.code === undefined ? undefined : String(response.error.code);
  return {
    taskId: response.id ?? taskId,
    model: response.model ?? undefined,
    status,
    clientBusinessId: response.client_business_id ?? undefined,
    resultUrls,
    errorCode,
    errorMessage: response.error?.message?.trim() || response.fail_reason?.trim() || undefined,
    usage: mode === "lookup" || !PENDING_STATUSES.has(status) ? toapisUsage(ctx, response) : undefined,
  };
}

/** Polls the same task until completed (URLs + usage) or failed (thrown). */
export async function waitForToapisTask(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  taskId: string,
  schedule: PollSchedule,
): Promise<{ resultUrls: string[]; usage: ImageUsage | undefined }> {
  return pollTask(ctx, {
    ...schedule,
    taskId,
    transientFailureLimit: MAX_TRANSIENT_POLL_FAILURES,
    check: async () => {
      const record = await fetchToapisTaskRecord(ctx, apiKey, baseUrl, taskId, "poll");
      if (record.status === "completed") return { done: true, value: { resultUrls: record.resultUrls ?? [], usage: record.usage } };
      if (record.status === "failed") throw taskFailedError(ctx, record);
      return { done: false, status: record.status };
    },
  });
}

function taskFailedError(ctx: OperationContext, record: ToapisTaskRecord) {
  const message = record.errorMessage ?? "ToAPIs returned no failure message";
  return contextError(ctx, `Task ${record.taskId} failed: ${message}${record.errorCode ? ` (${record.errorCode})` : ""}.`, {
    code: looksLikeContentBlock(message, record.errorCode) ? "content_blocked" : "task_failed",
    operation: "poll",
    taskId: record.taskId,
    providerCode: record.errorCode,
  });
}

function toapisUsage(ctx: OperationContext, response: { billing?: unknown; usage?: unknown }): ImageUsage | undefined {
  const billing = parseUsageBlock(ctx, billingSchema, response.billing, "ToAPIs billing");
  const usage = parseUsageBlock(ctx, usageSchema, response.usage, "ToAPIs usage");
  const input = usage?.input_tokens_details;
  const output = usage?.output_tokens_details;
  return compactUsage({
    credits: billing?.credits,
    costUsd: billing?.cost_usd,
    billingStatus: billing?.status,
    tokens: {
      input: usage?.input_tokens,
      output: usage?.output_tokens,
      total: usage?.total_tokens,
      inputText: input?.text_tokens,
      inputImage: input?.image_tokens,
      cachedInput: input?.cached_tokens,
      cachedInputText: input?.cached_tokens_details?.text_tokens,
      cachedInputImage: input?.cached_tokens_details?.image_tokens,
      outputText: output?.text_tokens,
      outputImage: output?.image_tokens,
    },
  });
}

function resultUrlsFor(ctx: OperationContext, taskId: string, response: { result?: unknown }, mode: ToapisRecordMode): string[] | undefined {
  const parsed = resultSchema.safeParse(response.result);
  if (parsed.success) return parsed.data.data.map((item) => item.url);
  if (mode === "poll") throw invalid(ctx, taskId, "completed without valid result.data[].url", response);
  emitProgress(ctx, { type: "warning", message: `Task ${taskId}: resultUrls omitted (no valid result.data[].url).` });
  return undefined;
}

function invalid(ctx: OperationContext, taskId: string, reason: string, response: unknown) {
  return contextError(ctx, `Task ${taskId} ${reason}.`, {
    code: "invalid_response",
    operation: "poll",
    taskId,
    responseBody: truncate(safeStringify(response)),
  });
}
