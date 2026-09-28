import { z } from "zod";
import {
  assertApiKey,
  createOperationContext,
  parseRequest,
  type FetchLike,
  type ImageUsage,
} from "@hk01/pi-ai-extra-internal";
import { KIE_API_BASE_URL, KIE_PROVIDER_ID } from "./constants.ts";
import { fetchKieTaskRecord, type KieTaskState } from "./task.ts";

export interface GetKieTaskOptions {
  apiKey: string;
  taskId: string;
  /** Model id used only for error context when known. */
  model?: string | undefined;
  /** Default `https://api.kie.ai`. */
  apiBaseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Request timeout in milliseconds. Default 30 s. */
  timeoutMs?: number | undefined;
  fetch?: FetchLike | undefined;
}

export interface KieTaskInfo {
  provider: string;
  taskId: string;
  model: string | undefined;
  state: KieTaskState;
  /** Temporary result URLs when `state` is `success`. */
  resultUrls: string[] | undefined;
  failCode: string | undefined;
  failMessage: string | undefined;
  /** `creditsConsumed` / `costTime` as reported by this lookup; omitted fields were not reported. */
  usage: ImageUsage | undefined;
}

const optionsSchema = z.strictObject({
  taskId: z.string().trim().min(1, "taskId is required"),
  apiBaseUrl: z.url({ protocol: /^https?$/ }).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/**
 * Re-reads one KIE task by id (`recordInfo`) and returns its state and usage.
 * A failed task is returned as `state: "fail"`, not thrown. Use it to reconcile
 * billing per task id instead of summing values observed while polling.
 */
export async function getKieTask(options: GetKieTaskOptions): Promise<KieTaskInfo> {
  const ctx = createOperationContext({
    provider: KIE_PROVIDER_ID,
    model: options.model ?? `task:${options.taskId}`,
    signal: options.signal,
    fetch: options.fetch,
  });
  assertApiKey(ctx, options.apiKey);
  const parsed = parseRequest(ctx, optionsSchema, {
    taskId: options.taskId,
    apiBaseUrl: options.apiBaseUrl,
    timeoutMs: options.timeoutMs,
  });
  const apiBaseUrl = (parsed.apiBaseUrl ?? KIE_API_BASE_URL).replace(/\/+$/, "");
  const record = await fetchKieTaskRecord(ctx, options.apiKey, apiBaseUrl, parsed.taskId, true, parsed.timeoutMs);
  return { provider: KIE_PROVIDER_ID, ...record };
}
