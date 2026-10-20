import type { ModelCost } from "@earendil-works/pi-ai";

/** A provider's published chat rates, in USD per 1M tokens. Omit a cache rate the provider does not publish: `toModelCost` derives it. */
export interface PublishedRates {
  input: number;
  output: number;
  /** Cached-input (cache read) rate. */
  cacheRead?: number | undefined;
  /** Cache-write rate. */
  cacheWrite?: number | undefined;
}

/** An unpublished cache-write rate as a multiple of the input rate; `toModelCost` explains it. */
const UNPUBLISHED_CACHE_WRITE_FACTOR = 1.25;

/**
 * pi-ai `ModelCost` from a provider's published rates. Every rate is rounded to 6 decimal places
 * to drop floating-point noise, and a cache rate the provider does not publish is derived; when
 * all four are published (KIE Codex), nothing is derived.
 *
 * **Cache fill-in rule.** This is the one place it is stated; the rate tables and their tests
 * point here. A derived rate is not a published one:
 * - an unpublished cache-read rate is the input rate, an upper bound (Anthropic and OpenAI charge
 *   less for cached input);
 * - an unpublished cache-write rate is 1.25 × input, Anthropic's 5-minute write and KIE's own
 *   Codex ratio. A 1-hour write (pi-ai `cacheRetention: "long"`) costs 2 × input on Anthropic;
 *   the Chat kit uses short retention.
 *
 * The rule is interim (ADR 0005); the dated model rates that follow this refactor (PR #19)
 * decide whether it stays.
 */
export function toModelCost(rates: PublishedRates): ModelCost {
  return {
    input: roundRate(rates.input),
    output: roundRate(rates.output),
    cacheRead: roundRate(rates.cacheRead ?? rates.input),
    cacheWrite: roundRate(rates.cacheWrite ?? rates.input * UNPUBLISHED_CACHE_WRITE_FACTOR),
  };
}

/**
 * The cost of a consumer-supplied chat model definition without `cost`: `0` for every rate, so
 * pi-ai reports a zero `usage.cost` for that model. The glossary's Model rate forbids a zero rate
 * (a model whose rate is not published has no rate) except as this interim: pi-ai's `Model.cost`
 * cannot be absent. What remains is a way for a model to have no rate; the dated model rates
 * (PR #19) add it and replace this zero.
 */
export const INTERIM_ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** `170 × 0.005` is `0.85`, not `0.8500000000000001`. */
function roundRate(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}
