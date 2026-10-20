import { estimateCostUsd, type ModelRate } from "@hk01/pi-ai-extra-internal/rates";
import type { ChatUsage } from "./types.ts";

/** How a provider kind's turns are priced. Each kind sets its own in `PROVIDER_KIND_SPECS`. */
export interface CostPolicy {
  /** The charge the provider reported in a turn's raw usage record, in USD; undefined when it reported none. */
  reportedCostUsd(raw: Record<string, unknown>): number | undefined;
  /** Whether a turn without a reported charge is estimated from the model's rate. */
  readonly estimatesCost: boolean;
}

/** What a turn's cost is worked out from. */
export interface TurnPricing {
  /** The provider kind's cost policy. */
  policy: CostPolicy;
  /** The model's rate schedule; undefined when it has no rate. */
  rate: ModelRate | undefined;
  /** When the turn started (epoch ms): the rate period in force then prices it. */
  startedAt: number;
}

/**
 * The turn's usage with its cost, from the first source that applies:
 *
 * 1. **Provider-reported** (`costSource: "provider"`): the charge the kind's policy reads from the
 *    raw usage record (`reportedCostUsd`).
 * 2. **Estimated** (`costSource: "estimated"`), when the kind's policy estimates: the model's rate
 *    in force when the turn started, applied to the reported counts (`estimateCostUsd`).
 * 3. **None**: no rate, or no counts to price. The cost fields are omitted, never 0.
 */
export function withCost(usage: ChatUsage | undefined, pricing: TurnPricing): ChatUsage | undefined {
  if (usage === undefined) return undefined;
  const reported = pricing.policy.reportedCostUsd(usage.raw);
  if (reported !== undefined) return { ...usage, costUsd: reported, costSource: "provider" };
  if (!pricing.policy.estimatesCost || pricing.rate === undefined) return usage;
  const estimated = estimateCostUsd(
    pricing.rate,
    { input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cachedInputTokens, cacheWrite: usage.cacheWriteTokens },
    pricing.startedAt,
  );
  return estimated === undefined ? usage : { ...usage, costUsd: estimated, costSource: "estimated" };
}

/** A reported amount: a finite, non-negative number, otherwise not reported. */
export function reportedAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
