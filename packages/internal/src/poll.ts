import { sleep } from "./abort.ts";
import { contextError, elapsedMs, emitProgress, type OperationContext } from "./context.ts";
import { isPiAiExtraError } from "./errors.ts";

export type PollOutcome<T> = { done: true; value: T } | { done: false; status: string };

export interface PollSchedule {
  initialDelayMs: number;
  maxDelayMs: number;
  /** Multiplier applied to the delay after each pending poll. */
  factor: number;
  /** Random +/- fraction applied to each delay, spreading load across concurrent tasks. */
  jitterRatio: number;
  /** Deadline for reaching a terminal state, measured from the first poll wait. */
  timeoutMs: number;
}

export interface PollTaskOptions<T> extends PollSchedule {
  taskId: string;
  check: () => Promise<PollOutcome<T>>;
  /**
   * Consecutive retryable status-query failures (after the request's own retries) that
   * are tolerated by polling the same task again. Terminal task failures always throw.
   */
  transientFailureLimit?: number | undefined;
}

/**
 * Polls one provider task until it reaches a terminal state. `check` throws for
 * terminal failures; this loop only handles waiting, progress and the deadline.
 */
export async function pollTask<T>(ctx: OperationContext, options: PollTaskOptions<T>): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  const check = tolerateTransientFailures(options.check, options.transientFailureLimit ?? 0);
  let delay = options.initialDelayMs;
  let lastStatus: string | undefined;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError(ctx, options, lastStatus);
    await sleep(ctx, Math.min(withJitter(delay, options.jitterRatio), remaining), "poll", options.taskId);

    const outcome = await check();
    if (outcome.done) return outcome.value;
    if (outcome.status !== lastStatus) {
      lastStatus = outcome.status;
      emitProgress(ctx, { type: "task_status", taskId: options.taskId, status: outcome.status, elapsedMs: elapsedMs(ctx) });
    }
    delay = Math.min(options.maxDelayMs, delay * options.factor);
  }
}

function tolerateTransientFailures<T>(check: () => Promise<PollOutcome<T>>, limit: number): () => Promise<PollOutcome<T>> {
  let consecutiveFailures = 0;
  return async () => {
    try {
      const outcome = await check();
      consecutiveFailures = 0;
      return outcome;
    } catch (error) {
      if (!isPiAiExtraError(error) || !error.retryable || consecutiveFailures >= limit) throw error;
      consecutiveFailures += 1;
      return { done: false, status: `status query failed (${error.code}); retrying` };
    }
  };
}

function withJitter(delay: number, ratio: number): number {
  if (ratio <= 0) return delay;
  return Math.max(0, delay * (1 + (Math.random() * 2 - 1) * ratio));
}

function timeoutError<T>(ctx: OperationContext, options: PollTaskOptions<T>, lastStatus: string | undefined) {
  const seconds = Math.round(options.timeoutMs / 1000);
  return contextError(
    ctx,
    `Task ${options.taskId} did not finish within ${seconds}s (last status: ${lastStatus ?? "unknown"}). It may still complete on the provider side; inspect it there by task id.`,
    { code: "timeout", operation: "poll", taskId: options.taskId },
  );
}
