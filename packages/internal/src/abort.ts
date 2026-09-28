import { contextError, type OperationContext } from "./context.ts";
import type { PiAiExtraError, PiAiExtraOperation } from "./errors.ts";

export function abortedError(ctx: OperationContext, operation?: PiAiExtraOperation, taskId?: string): PiAiExtraError {
  return contextError(ctx, "Request was cancelled by the caller.", {
    code: "aborted",
    operation,
    taskId,
    cause: ctx.signal?.reason,
  });
}

export function throwIfAborted(ctx: OperationContext, operation?: PiAiExtraOperation, taskId?: string): void {
  if (ctx.signal?.aborted) throw abortedError(ctx, operation, taskId);
}

/** Waits `ms` milliseconds, rejecting with an `aborted` error as soon as the caller cancels. */
export function sleep(ctx: OperationContext, ms: number, operation?: PiAiExtraOperation, taskId?: string): Promise<void> {
  const signal = ctx.signal;
  if (signal?.aborted) return Promise.reject(abortedError(ctx, operation, taskId));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError(ctx, operation, taskId));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
