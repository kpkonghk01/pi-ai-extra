import { estimateCostUsd, roundUsd, type ModelRate } from "@hk01/pi-ai-extra-internal/rates";
import { isRecord } from "./guards.ts";
import type { ChatProviderKind, ChatUsage } from "./types.ts";

/** USD per KIE credit, from the `usdPrice` of KIE's pricing listing. */
const KIE_USD_PER_CREDIT = 0.005;

/** What a turn's cost is worked out from. */
export interface TurnPricing {
  kind: ChatProviderKind;
  /** The model's rate schedule; undefined when it has no rate. */
  rate: ModelRate | undefined;
  /** When the turn started (epoch ms): the rate period in force then prices it. */
  startedAt: number;
}

/**
 * The turn's usage with its cost, from the first source that applies:
 *
 * 1. **Provider-reported** (`costSource: "provider"`): OpenRouter's `usage.cost`, or KIE's
 *    `credits_consumed` × $0.005. KIE's cost always comes from its credits, because its token
 *    counts are unreliable (hidden prompt tokens, some zero input counts), so KIE without
 *    credits has no cost.
 * 2. **Estimated** (`costSource: "estimated"`): the model's rate in force when the turn started,
 *    applied to the reported counts (`estimateCostUsd`).
 * 3. **None**: no rate, or no counts to price. The cost fields are omitted, never 0.
 */
export function withCost(usage: ChatUsage | undefined, pricing: TurnPricing): ChatUsage | undefined {
  if (usage === undefined) return undefined;
  const reported = reportedCostUsd(usage.raw, pricing.kind);
  if (reported !== undefined) return { ...usage, costUsd: reported, costSource: "provider" };
  if (pricing.kind === "kie" || pricing.rate === undefined) return usage;
  const estimated = estimateCostUsd(
    pricing.rate,
    { input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cachedInputTokens, cacheWrite: usage.cacheWriteTokens },
    pricing.startedAt,
  );
  return estimated === undefined ? usage : { ...usage, costUsd: estimated, costSource: "estimated" };
}

/** The charge the provider reported in its raw usage record, in USD. */
function reportedCostUsd(raw: Record<string, unknown>, kind: ChatProviderKind): number | undefined {
  if (kind === "openrouter") return isRecord(raw.usage) ? amount(raw.usage.cost) : undefined;
  if (kind === "kie") {
    const credits = amount(raw.credits_consumed);
    return credits === undefined ? undefined : roundUsd(credits * KIE_USD_PER_CREDIT);
  }
  return undefined;
}

/** A reported amount: a finite, non-negative number, otherwise not reported. */
function amount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
