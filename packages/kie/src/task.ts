import { z } from "zod";
import {
  compactUsage,
  contextError,
  emitProgress,
  looksLikeContentBlock,
  parseUsageBlock,
  pollTask,
  requestJson,
  safeStringify,
  truncate,
  type ImageUsage,
  type OperationContext,
  type PollSchedule,
  type RetryPolicy,
} from "@hk01/pi-ai-extra-internal";
import { bearerHeaders, envelope, envelopeData } from "./envelope.ts";

export type KieTaskState = "waiting" | "queuing" | "generating" | "success" | "fail";

/** One `recordInfo` observation, validated. */
export interface KieTaskRecord {
  taskId: string;
  model: string | undefined;
  state: KieTaskState;
  /** Present when `state` is `success`. */
  resultUrls: string[] | undefined;
  failCode: string | undefined;
  failMessage: string | undefined;
  usage: ImageUsage | undefined;
}

const POLL_REQUEST_TIMEOUT_MS = 30_000;
const POLL_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000 };
const MAX_TRANSIENT_POLL_FAILURES = 3;

/**
 * `poll`: strict (a malformed success fails the generation); usage parsed on terminal states.
 * `lookup`: billing reconciliation; usage always parsed, and a malformed result is reported as a
 * warning with `resultUrls: undefined` so the billing record is still returned.
 */
export type KieRecordMode = "poll" | "lookup";
const STATES = ["waiting", "queuing", "generating", "success", "fail"] as const;
const PENDING_STATES: ReadonlySet<string> = new Set(["waiting", "queuing", "generating"]);

const recordInfoResponse = envelope(
  z.object({
    model: z.string().nullish(),
    state: z.string(),
    resultJson: z.string().nullish(),
    failCode: z.union([z.string(), z.number()]).nullish(),
    failMsg: z.string().nullish(),
    // Usage fields are validated separately so a shape change cannot fail a finished task.
    creditsConsumed: z.unknown().optional(),
    costTime: z.unknown().optional(),
  }),
);
const resultJsonSchema = z.object({ resultUrls: z.array(z.url()).min(1) });

/** Reads `GET /api/v1/jobs/recordInfo` once. */
export async function fetchKieTaskRecord(
  ctx: OperationContext,
  apiKey: string,
  apiBaseUrl: string,
  taskId: string,
  mode: KieRecordMode,
  timeoutMs: number = POLL_REQUEST_TIMEOUT_MS,
): Promise<KieTaskRecord> {
  const response = await requestJson(
    ctx,
    {
      url: `${apiBaseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      method: "GET",
      headers: bearerHeaders(apiKey),
      operation: "poll",
      taskId,
      timeoutMs,
      retry: POLL_RETRY,
    },
    recordInfoResponse,
  );
  const data = envelopeData(ctx, response, "poll", "recordInfo", taskId);
  const state = STATES.find((known) => known === data.state);
  if (!state) {
    throw contextError(ctx, `Task ${taskId} returned unknown state ${JSON.stringify(data.state)}.`, {
      code: "invalid_response",
      operation: "poll",
      taskId,
      responseBody: truncate(safeStringify(response)),
    });
  }
  const terminal = !PENDING_STATES.has(state);
  return {
    taskId,
    model: data.model ?? undefined,
    state,
    resultUrls: state === "success" ? resultUrlsFor(ctx, data.resultJson, taskId, mode) : undefined,
    failCode: data.failCode === null || data.failCode === undefined || data.failCode === "" ? undefined : String(data.failCode),
    failMessage: data.failMsg?.trim() || undefined,
    usage: mode === "lookup" || terminal ? kieUsage(ctx, data) : undefined,
  };
}

/** Polls the same task until success (result URLs + usage) or failure (thrown with KIE's failCode/failMsg). */
export async function waitForKieTask(
  ctx: OperationContext,
  apiKey: string,
  apiBaseUrl: string,
  taskId: string,
  schedule: PollSchedule,
): Promise<{ resultUrls: string[]; usage: ImageUsage | undefined }> {
  return pollTask(ctx, {
    ...schedule,
    taskId,
    transientFailureLimit: MAX_TRANSIENT_POLL_FAILURES,
    check: async () => {
      const record = await fetchKieTaskRecord(ctx, apiKey, apiBaseUrl, taskId, "poll");
      if (record.state === "success") return { done: true, value: { resultUrls: record.resultUrls ?? [], usage: record.usage } };
      if (record.state === "fail") throw taskFailedError(ctx, record);
      return { done: false, status: record.state };
    },
  });
}

function taskFailedError(ctx: OperationContext, record: KieTaskRecord) {
  const failMsg = record.failMessage ?? "KIE returned no failure message";
  return contextError(ctx, `Task ${record.taskId} failed: ${failMsg}${record.failCode ? ` (failCode ${record.failCode})` : ""}.`, {
    code: looksLikeContentBlock(record.failMessage) ? "content_blocked" : "task_failed",
    operation: "poll",
    taskId: record.taskId,
    providerCode: record.failCode,
  });
}

/**
 * `creditsConsumed` (credits deducted) and `costTime` from `recordInfo`. KIE's
 * "Get Task Details" (recordInfo) reference documents `costTime` in milliseconds,
 * while its callback schema says seconds; this follows the recordInfo reference.
 */
function kieUsage(ctx: OperationContext, data: { creditsConsumed?: unknown; costTime?: unknown }): ImageUsage | undefined {
  return compactUsage({
    credits: parseUsageBlock(ctx, z.number().nonnegative(), data.creditsConsumed, "KIE creditsConsumed"),
    providerDurationMs: parseUsageBlock(ctx, z.number().int().nonnegative(), data.costTime, "KIE costTime"),
  });
}

function resultUrlsFor(ctx: OperationContext, resultJson: string | null | undefined, taskId: string, mode: KieRecordMode): string[] | undefined {
  if (mode === "poll") return parseResultUrls(ctx, resultJson, taskId);
  try {
    return parseResultUrls(ctx, resultJson, taskId);
  } catch (error) {
    emitProgress(ctx, { type: "warning", message: `resultUrls omitted: ${(error as Error).message}` });
    return undefined;
  }
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
