import { sleep } from "./abort.ts";
import type { OperationContext } from "./context.ts";
import { isPiAiExtraError, type PiAiExtraOperation } from "./errors.ts";

export interface RetryPolicy {
  /** Total attempts including the first one. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Result downloads: temporary URLs are fetched promptly and retried briefly. */
export const DOWNLOAD_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 5_000 };
/** Reference uploads: same bytes, same provider endpoint. */
export const UPLOAD_RETRY: RetryPolicy = { attempts: 2, baseDelayMs: 1_000, maxDelayMs: 5_000 };

/**
 * Repeats `attempt` only for errors marked `retryable`, against the same request,
 * honouring a provider `Retry-After` (capped at `maxDelayMs`). Never used for task
 * submission or billed generation, and never switches provider, model or URL.
 */
export async function withRetry<T>(
  ctx: OperationContext,
  policy: RetryPolicy | undefined,
  operation: PiAiExtraOperation,
  taskId: string | undefined,
  attempt: () => Promise<T>,
): Promise<T> {
  const attempts = Math.max(1, policy?.attempts ?? 1);
  for (let count = 1; ; count += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!policy || !isPiAiExtraError(error) || !error.retryable || count >= attempts) throw error;
      const backoff = policy.baseDelayMs * 2 ** (count - 1);
      await sleep(ctx, Math.min(policy.maxDelayMs, error.retryAfterMs ?? backoff), operation, taskId);
    }
  }
}
