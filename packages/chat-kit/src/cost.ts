import { calculateCost, type Api, type Model, type Usage } from "@earendil-works/pi-ai";
import type { ChatProviderTraits } from "@hk01/pi-ai-extra-internal/pi-ai";
import { modelCostAt, ratePeriodAt, roundUsd, type ModelRate } from "@hk01/pi-ai-extra-internal/rates";
import type { ChatUsage } from "./types.ts";

/** What a turn's cost is worked out from. */
export interface TurnPricing {
  /** The provider's cost policy: its own charge, and whether a turn without one is estimated. */
  policy: Pick<ChatProviderTraits, "reportedCostUsd" | "estimatesCost">;
  /** The model's rate schedule (`describe(model).rate`); undefined when it has no rate. */
  rate: ModelRate | undefined;
  /** When the turn started (epoch ms): the rate period in force then prices it. */
  startedAt: number;
}

/**
 * The turn's usage with its cost, from the first source that applies:
 *
 * 1. **Provider-reported** (`costSource: "provider"`): the charge the provider's policy reads from
 *    the raw usage record (`reportedCostUsd`).
 * 2. **Estimated** (`costSource: "estimated"`), when the policy estimates: the model's rate in
 *    force when the turn started, applied to the reported counts (`estimateCostUsd`).
 * 3. **None**: no rate, or no counts to price. The cost fields are omitted, never 0.
 */
export function withCost(usage: ChatUsage | undefined, pricing: TurnPricing): ChatUsage | undefined {
  if (usage === undefined) return undefined;
  const reported = pricing.policy.reportedCostUsd(usage.raw);
  if (reported !== undefined) return { ...usage, costUsd: reported, costSource: "provider" };
  if (!pricing.policy.estimatesCost || pricing.rate === undefined) return usage;
  const estimated = estimateCostUsd(pricing.rate, usage, pricing.startedAt);
  return estimated === undefined ? usage : { ...usage, costUsd: estimated, costSource: "estimated" };
}

/**
 * Estimated USD cost of one turn: pi-ai's `calculateCost` with the `Model.cost` of the period in
 * force at `at` (`modelCostAt`: unpublished cache rates filled in, the large-prompt tier as a pi-ai
 * tier, chosen by the whole prompt, `input + cacheRead + cacheWrite`). Cache writes are priced as
 * 5-minute writes, since turns use short cache retention; reasoning is part of the output. A count
 * the provider did not report adds nothing. Undefined when the schedule has no period at `at`, or
 * when neither a prompt nor an answer count was reported.
 */
export function estimateCostUsd(
  rate: ModelRate,
  counts: Pick<ChatUsage, "input" | "output" | "cacheRead" | "cacheWrite">,
  at: number,
): number | undefined {
  if (counts.input === undefined && counts.output === undefined) return undefined;
  if (ratePeriodAt(rate, at) === undefined) return undefined;
  const usage: Usage = {
    input: counts.input ?? 0,
    output: counts.output ?? 0,
    cacheRead: counts.cacheRead ?? 0,
    cacheWrite: counts.cacheWrite ?? 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  // `calculateCost` reads only the model's `cost`.
  return roundUsd(calculateCost({ cost: modelCostAt(rate, at) } as Model<Api>, usage).total);
}
