import type { ModelCost } from "@earendil-works/pi-ai";

/*
 * Model rates (the glossary's Model rate): a provider's published per-token prices for one chat
 * model, in USD per 1M tokens, as a dated schedule. A model without a schedule has no rate, never
 * a zero rate. A request is priced at the period in force when it was made, and has no rate
 * before the schedule's first period.
 */

/**
 * Per-token rates in USD per 1M tokens. Omit a cache rate the provider does not publish: it is
 * derived when a request is priced (`toModelCost`).
 */
export interface TokenRates {
  input: number;
  output: number;
  /** Cached-input (cache read) rate. */
  cacheRead?: number | undefined;
  /** Cache-write rate. */
  cacheWrite?: number | undefined;
}

/** The rates for a whole request whose prompt is over `overPromptTokens` tokens (for example Gemini 3.1 Pro over 200k). */
export interface LargePromptRates extends TokenRates {
  overPromptTokens: number;
}

/** One period of a model's published rates. */
export interface RatePeriod extends TokenRates {
  /**
   * First UTC day (`YYYY-MM-DD`) on which this period applies. Only the first period may omit it:
   * it then applies from the beginning. Before the first period's day, the model has no rate.
   */
  from?: string | undefined;
  largePrompt?: LargePromptRates | undefined;
}

/** A chat model's rate schedule: its periods in date order, earliest first. */
export interface ModelRate {
  periods: readonly RatePeriod[];
}

/** The token counts a provider reported for one request, as the chat kit reads them. */
interface PricedCounts {
  /** Every prompt token: cache reads and writes included. */
  input?: number | undefined;
  /** Every generated token, reasoning included. */
  output?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
}

/** An unpublished cache-write rate as a multiple of the input rate; `toModelCost` explains it. */
const UNPUBLISHED_CACHE_WRITE_FACTOR = 1.25;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A schedule with one period that applies from the beginning (KIE and ToAPIs publish no dates). */
export function singleRate(rates: TokenRates & { largePrompt?: LargePromptRates | undefined }): ModelRate {
  return { periods: [rates] };
}

/**
 * The period in force at `at`: the last period whose `from` day has started (UTC). Undefined
 * before the first period's day, since no rate was in force yet (the glossary's Model rate: a
 * request is priced at the rate in force when it was made), and for a schedule without periods.
 */
export function ratePeriodAt(rate: ModelRate, at: Date | number): RatePeriod | undefined {
  const time = typeof at === "number" ? at : at.getTime();
  let current: RatePeriod | undefined;
  for (const period of rate.periods) {
    if (period.from === undefined || startOfDay(period.from) <= time) current = period;
  }
  return current;
}

/** The rates a request pays in a period: its large-prompt tier when the prompt is over the tier's threshold. */
function ratesForPrompt(period: RatePeriod, promptTokens: number | undefined): TokenRates {
  const tier = period.largePrompt;
  return tier !== undefined && promptTokens !== undefined && promptTokens > tier.overPromptTokens ? tier : period;
}

/**
 * pi-ai `ModelCost` from one set of published rates: every rate a price needs. Every rate is
 * rounded to 6 decimal places to drop floating-point noise, and a cache rate the provider does
 * not publish is derived; when all four are published (KIE Codex), nothing is derived.
 *
 * **Cache fill-in rule.** This is the one place in code that states it; the rate tables and
 * their tests point here. A derived rate is not part of the published rate (the glossary's
 * Model rate):
 * - an unpublished cache-read rate is the input rate, an upper bound (Anthropic and OpenAI charge
 *   less for cached input);
 * - an unpublished cache-write rate is 1.25 × input, Anthropic's 5-minute write and KIE's own
 *   Codex ratio. A 1-hour write (pi-ai `cacheRetention: "long"`) costs 2 × input on Anthropic;
 *   the Chat kit uses short retention.
 */
export function toModelCost(rates: TokenRates): ModelCost {
  return {
    input: roundRate(rates.input),
    output: roundRate(rates.output),
    cacheRead: roundRate(rates.cacheRead ?? rates.input),
    cacheWrite: roundRate(rates.cacheWrite ?? rates.input * UNPUBLISHED_CACHE_WRITE_FACTOR),
  };
}

/**
 * pi-ai's `Model.cost` cannot be absent, so a model with no rate carries these zeros there. They
 * are a placeholder, not a rate: the model has none, the chat kit reports no cost for it, and
 * pi-ai's own `usage.cost` for it is meaningless.
 */
const NO_RATE_PLACEHOLDER_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * pi-ai `Model.cost` from the period in force at `at`, with unpublished cache rates filled in and
 * its large-prompt tier as a pi-ai cost tier. pi-ai requires the field; the chat kit prices a turn
 * from the schedule itself, at call time. No rate, or none in force yet at `at`: the placeholder
 * zeros above.
 */
export function modelCostAt(rate: ModelRate | undefined, at: Date | number): ModelCost {
  const period = rate === undefined ? undefined : ratePeriodAt(rate, at);
  if (period === undefined) return NO_RATE_PLACEHOLDER_COST;
  const cost = toModelCost(period);
  if (period.largePrompt === undefined) return cost;
  return { ...cost, tiers: [{ inputTokensAbove: period.largePrompt.overPromptTokens, ...toModelCost(period.largePrompt) }] };
}

/**
 * A pi-ai catalogue price (`Model.cost`) as a one-period schedule, for a model whose provider
 * publishes no schedule of its own. pi-ai's catalogue has no "unpublished", so a zero cache rate
 * is read as unpublished, and a model priced at zero for both input and output has no rate: an
 * unknown price is never a zero price. The first pi-ai cost tier becomes the large-prompt tier.
 */
export function catalogueRate(cost: ModelCost | undefined): ModelRate | undefined {
  if (cost === undefined || (cost.input === 0 && cost.output === 0)) return undefined;
  const tier = cost.tiers?.[0];
  return singleRate({
    ...publishedOf(cost),
    ...(tier === undefined ? {} : { largePrompt: { overPromptTokens: tier.inputTokensAbove, ...publishedOf(tier) } }),
  });
}

function publishedOf(rates: { input: number; output: number; cacheRead: number; cacheWrite: number }): TokenRates {
  return {
    input: rates.input,
    output: rates.output,
    ...(rates.cacheRead > 0 ? { cacheRead: rates.cacheRead } : {}),
    ...(rates.cacheWrite > 0 ? { cacheWrite: rates.cacheWrite } : {}),
  };
}

/**
 * Estimated USD cost of one request from the period in force at `at`, applied to the counts the
 * provider reported: the large-prompt tier is chosen by the prompt count, cached and cache-write
 * tokens are charged at their (filled-in) rates and the rest of the prompt at the input rate;
 * reasoning is part of the output. A count the provider did not report adds nothing. Undefined
 * when the schedule has no period, or when neither a prompt nor an answer count was reported.
 */
export function estimateCostUsd(rate: ModelRate, counts: PricedCounts, at: Date | number): number | undefined {
  if (counts.input === undefined && counts.output === undefined) return undefined;
  const period = ratePeriodAt(rate, at);
  if (period === undefined) return undefined;
  const rates = toModelCost(ratesForPrompt(period, counts.input));
  const cacheRead = counts.cacheRead ?? 0;
  const cacheWrite = counts.cacheWrite ?? 0;
  const uncached = Math.max(0, (counts.input ?? 0) - cacheRead - cacheWrite);
  const perMillion =
    uncached * rates.input + cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite + (counts.output ?? 0) * rates.output;
  return roundUsd(perMillion / 1_000_000);
}

/**
 * Throws a `TypeError` unless `rate` is a valid schedule: at least one period, `from` an ISO day
 * on every period but the first, days strictly increasing, and every rate and threshold a
 * non-negative number.
 */
export function assertModelRate(rate: ModelRate, label: string): void {
  const fail = (problem: string): never => {
    throw new TypeError(`${label}: invalid rate: ${problem}`);
  };
  if (!Array.isArray(rate.periods) || rate.periods.length === 0) fail("it needs at least one period");
  let previous = Number.NEGATIVE_INFINITY;
  rate.periods.forEach((period, index) => {
    if (period.from === undefined) {
      if (index > 0) fail(`periods[${index}] needs a from date; only the first period may omit it`);
    } else {
      const day = ISO_DATE.test(period.from) ? startOfDay(period.from) : Number.NaN;
      if (Number.isNaN(day)) fail(`periods[${index}].from ${JSON.stringify(period.from)} is not a YYYY-MM-DD date`);
      if (day <= previous) fail(`periods[${index}].from must be later than the period before it`);
      previous = day;
    }
    checkRates(period, `periods[${index}]`, fail);
    if (period.largePrompt !== undefined) {
      checkRates(period.largePrompt, `periods[${index}].largePrompt`, fail);
      const threshold = period.largePrompt.overPromptTokens;
      if (!Number.isSafeInteger(threshold) || threshold <= 0) fail(`periods[${index}].largePrompt.overPromptTokens must be a positive integer`);
    }
  });
}

function checkRates(rates: TokenRates, path: string, fail: (problem: string) => never): void {
  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    const value = rates[key];
    if (value === undefined && (key === "cacheRead" || key === "cacheWrite")) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${path}.${key} must be a non-negative number`);
  }
}

function startOfDay(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/**
 * A rate in USD per 1M tokens to 6 decimal places, dropping floating-point noise: `11.2 × 0.005`
 * is `0.056`, not `0.055999999999999994`. Every rate a package derives from a provider's own unit
 * (KIE credits, ToAPIs ratios, OpenRouter per-token prices) goes through it.
 */
export function roundRate(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/** A cost to 10 decimal places: exact enough for a fraction of a token, without floating-point noise. */
export function roundUsd(usd: number): number {
  return Math.round(usd * 1e10) / 1e10;
}
