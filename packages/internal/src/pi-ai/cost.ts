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
 * pi-ai `ModelCost` from a provider's published rates. A cache rate the provider does not
 * publish is filled in: cache reads at the input rate, an upper bound (Anthropic and OpenAI
 * charge less for cached input), and cache writes at 1.25 × input, Anthropic's 5-minute ratio.
 * This rule is interim until DATA-4568 settles model rates. Every rate is rounded to 6 decimal
 * places to drop floating-point noise.
 */
export function publishedCost(rates: PublishedRates): ModelCost {
  return {
    input: roundRate(rates.input),
    output: roundRate(rates.output),
    cacheRead: roundRate(rates.cacheRead ?? rates.input),
    cacheWrite: roundRate(rates.cacheWrite ?? rates.input * UNPUBLISHED_CACHE_WRITE_FACTOR),
  };
}

/** `170 × 0.005` is `0.85`, not `0.8500000000000001`. */
function roundRate(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
