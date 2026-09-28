import { z } from "zod";
import { assertApiKey, createOperationContext, parseRequest, type FetchLike, type ImageUsage } from "@hk01/pi-ai-extra-internal";
import { TOAPIS_BASE_URL, TOAPIS_PROVIDER_ID } from "./constants.ts";
import { fetchToapisTaskRecord, type ToapisTaskStatus } from "./task.ts";

export interface GetToapisTaskOptions {
  apiKey: string;
  /** Task id returned at submission, or the `clientBusinessId` sent with it. */
  taskId: string;
  /** Model id used only for error context when known. */
  model?: string | undefined;
  /** Default `https://toapis.com`. */
  baseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Request timeout in milliseconds. Default 30 s. */
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
}

export interface ToapisTaskInfo {
  provider: string;
  taskId: string;
  model: string | undefined;
  status: ToapisTaskStatus;
  clientBusinessId: string | undefined;
  /** Temporary result URLs when `status` is `completed`. */
  resultUrls: string[] | undefined;
  errorCode: string | undefined;
  errorMessage: string | undefined;
  /**
   * Billing and token usage from this lookup. `billingStatus: "pending"` means the
   * amount is not final even if the task is completed; query again later and replace
   * (never add to) the value recorded for this task id.
   */
  usage: ImageUsage | undefined;
}

const optionsSchema = z.strictObject({
  taskId: z.string().trim().min(1, "taskId is required").max(256),
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/**
 * Re-reads one ToAPIs image task (`GET /v1/images/generations/{taskId}`) and returns
 * its status, billing and usage. A failed task is returned as `status: "failed"`,
 * not thrown. Use it to settle billing that was still `pending` at completion.
 */
export async function getToapisTask(options: GetToapisTaskOptions): Promise<ToapisTaskInfo> {
  const ctx = createOperationContext({
    provider: TOAPIS_PROVIDER_ID,
    model: options.model ?? `task:${options.taskId}`,
    signal: options.signal,
    fetch: options.fetch,
  });
  assertApiKey(ctx, options.apiKey);
  const parsed = parseRequest(ctx, optionsSchema, { taskId: options.taskId, baseUrl: options.baseUrl, timeoutMs: options.timeoutMs });
  const baseUrl = (parsed.baseUrl ?? TOAPIS_BASE_URL).replace(/\/+$/, "");
  const record = await fetchToapisTaskRecord(ctx, options.apiKey, baseUrl, parsed.taskId, true, parsed.timeoutMs);
  return { provider: TOAPIS_PROVIDER_ID, ...record };
}
