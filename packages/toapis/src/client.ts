import { z } from "zod";
import {
  contextError,
  fileExtension,
  isPiAiExtraError,
  looksLikeContentBlock,
  pollTask,
  requestJson,
  safeStringify,
  truncate,
  type InlineReference,
  type OperationContext,
  type PollOutcome,
  type PollSchedule,
  type RetryPolicy,
} from "@hk01/pi-ai-extra-internal";

const UPLOAD_TIMEOUT_MS = 60_000;
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_RETRY: RetryPolicy = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000 };
const POLL_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 2_000, maxDelayMs: 30_000 };
const MAX_TRANSIENT_POLL_FAILURES = 3;

const uploadResponse = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.object({ url: z.url() }).nullish(),
});

const submitResponse = z
  .object({ id: z.string().min(1).optional(), task_id: z.string().min(1).optional() })
  .refine((body) => body.id !== undefined || body.task_id !== undefined, { message: "missing task id (id or task_id)" });

const providerError = z.object({ code: z.union([z.string(), z.number()]).nullish(), message: z.string().nullish() }).nullish();

const statusResponse = z.object({
  status: z.string(),
  result: z.object({ data: z.array(z.object({ url: z.url() })).nullish() }).nullish(),
  error: providerError,
  fail_reason: z.string().nullish(),
});

const PENDING_STATUSES = new Set(["pending", "queued", "in_progress"]);

/** Uploads one inline reference through ToAPIs `/v1/uploads/images` and returns its public URL. */
export async function uploadToToapis(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  reference: InlineReference,
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType });
  form.append("file", blob, `reference-${reference.index}.${fileExtension(reference.mimeType)}`);
  const response = await requestJson(
    ctx,
    {
      url: `${baseUrl}/v1/uploads/images`,
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      operation: "upload",
      timeoutMs: UPLOAD_TIMEOUT_MS,
      retry: UPLOAD_RETRY,
    },
    uploadResponse,
  );
  if (response.success && response.data) return response.data.url;
  throw contextError(ctx, `referenceImages[${reference.index}] upload failed: ${response.message?.trim() || "no message"}.`, {
    code: "upload_failed",
    operation: "upload",
    responseBody: truncate(safeStringify(response)),
  });
}

/** Creates an image generation task. Never retried automatically: a repeated submission could be billed twice. */
export async function createToapisTask(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await requestJson(
    ctx,
    {
      url: `${baseUrl}/v1/images/generations`,
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      operation: "submit",
      timeoutMs: SUBMIT_TIMEOUT_MS,
    },
    submitResponse,
  );
  return (response.id ?? response.task_id) as string;
}

/** Polls `GET /v1/images/generations/{taskId}` for the same task until completed or failed. */
export async function waitForToapisTask(
  ctx: OperationContext,
  apiKey: string,
  baseUrl: string,
  taskId: string,
  schedule: PollSchedule,
): Promise<string[]> {
  let consecutiveTransientFailures = 0;
  return pollTask(ctx, {
    ...schedule,
    taskId,
    check: async () => {
      try {
        const outcome = await checkToapisTask(ctx, apiKey, baseUrl, taskId);
        consecutiveTransientFailures = 0;
        return outcome;
      } catch (error) {
        if (isPiAiExtraError(error) && error.retryable && consecutiveTransientFailures < MAX_TRANSIENT_POLL_FAILURES) {
          consecutiveTransientFailures += 1;
          return { done: false, status: `status query failed (${error.code}); retrying` };
        }
        throw error;
      }
    },
  });
}

async function checkToapisTask(ctx: OperationContext, apiKey: string, baseUrl: string, taskId: string): Promise<PollOutcome<string[]>> {
  const response = await requestJson(
    ctx,
    {
      url: `${baseUrl}/v1/images/generations/${encodeURIComponent(taskId)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      operation: "poll",
      taskId,
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      retry: POLL_RETRY,
    },
    statusResponse,
  );

  if (PENDING_STATUSES.has(response.status)) return { done: false, status: response.status };
  if (response.status === "completed") {
    const urls = (response.result?.data ?? []).map((item) => item.url);
    if (urls.length > 0) return { done: true, value: urls };
    throw contextError(ctx, `Task ${taskId} completed without result.data[].url.`, {
      code: "invalid_response",
      operation: "poll",
      taskId,
      responseBody: truncate(safeStringify(response)),
    });
  }
  if (response.status === "failed") {
    const providerCode = response.error?.code === null || response.error?.code === undefined ? undefined : String(response.error.code);
    const message = response.error?.message?.trim() || response.fail_reason?.trim() || "ToAPIs returned no failure message";
    throw contextError(ctx, `Task ${taskId} failed: ${message}${providerCode ? ` (${providerCode})` : ""}.`, {
      code: looksLikeContentBlock(message, providerCode) ? "content_blocked" : "task_failed",
      operation: "poll",
      taskId,
      providerCode,
      responseBody: truncate(safeStringify(response)),
    });
  }
  throw contextError(ctx, `Task ${taskId} returned unknown status ${JSON.stringify(response.status)}.`, {
    code: "invalid_response",
    operation: "poll",
    taskId,
    responseBody: truncate(safeStringify(response)),
  });
}
