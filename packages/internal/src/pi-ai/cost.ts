import type { ModelCost } from "@earendil-works/pi-ai";

/** A provider's published chat rates, in USD per 1M tokens. Omit a cache rate the provider does not publish. */
export interface PublishedRates {
  input: number;
  output: number;
  /** Cached-input (cache read) rate. When omitted: the input rate. */
  cacheRead?: number | undefined;
  /** Cache-write rate. When omitted: 1.25 × the input rate. */
  cacheWrite?: number | undefined;
}

/**
 * Cache-write price relative to input where the provider publishes none. Anthropic charges
 * 1.25 × input for a 5-minute cache write, and KIE's own Codex rows publish the same ratio.
 * A 1-hour write (pi-ai `cacheRetention: "long"`) costs 2 × input on Anthropic; the Chat kit
 * uses short retention.
 */
const UNPUBLISHED_CACHE_WRITE_FACTOR = 1.25;

/**
 * pi-ai `ModelCost` from a provider's published rates, with every cache rate it does not publish
 * filled in. This is the one place the rule is applied and explained; the rate tables point here.
 *
 * **Cache fill-in rule.** The filled-in rates are derived, not published:
 * - an unpublished cache-read rate is the input rate, an upper bound (Anthropic and OpenAI charge
 *   less for cached input);
 * - an unpublished cache-write rate is 1.25 × input, Anthropic's 5-minute write and KIE's own
 *   Codex ratio (a 1-hour write costs 2 × input on Anthropic).
 *
 * **Interim zero.** A consumer-supplied chat model definition without `cost` gets
 * `UNPRICED_MODEL_COST` instead: the glossary's Model rate says an unpublished rate is no rate,
 * never a zero rate, but pi-ai's `Model.cost` cannot be absent.
 *
 * Both rules are interim until DATA-4568 settles model rates. Every rate is rounded to 6 decimal
 * places to drop floating-point noise.
 */
export function fillCacheRates(rates: PublishedRates): ModelCost {
  return {
    input: roundRate(rates.input),
    output: roundRate(rates.output),
    cacheRead: roundRate(rates.cacheRead ?? rates.input),
    cacheWrite: roundRate(rates.cacheWrite ?? rates.input * UNPUBLISHED_CACHE_WRITE_FACTOR),
  };
}

/** The interim zero cost of a consumer-supplied definition without `cost` (see `fillCacheRates`). */
export const UNPRICED_MODEL_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** `170 × 0.005` is `0.85`, not `0.8500000000000001`. */
function roundRate(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
