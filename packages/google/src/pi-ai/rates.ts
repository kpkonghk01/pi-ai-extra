import type { ModelCost } from "@earendil-works/pi-ai";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { singleRate, type ModelRate } from "@hk01/pi-ai-extra-internal/pi-ai";

/** Every rate in Gemini 3.8 and 3.6 Flash's schedule doubles on this day. */
const FLASH_DOUBLING_DAY = "2027-01-01";

/**
 * Gemini chat rates in USD per 1M tokens: Standard tier, paid, text, image and video input,
 * output including thinking, and cached input ("Caching") where Google publishes it. Rates as of
 * 2026-10-16, source: https://ai.google.dev/gemini-api/docs/pricing, ported from the
 * data-gen-ai-portal price table (`src/lib/pricing.ts`). Text models only.
 *
 * - Google schedules increases ahead of time, so a schedule has dated periods: 3.8 and 3.6 Flash
 *   double every rate on 2027-01-01 (the page: "through December 31, 2026", "starting
 *   January 1, 2027").
 * - 3.7 Flash is no longer on the page. Its rates are the portal's, which double on the same day;
 *   with no published cached-input rate, a cache read is priced at the input rate.
 * - Gemini publishes no per-token cache-write price (cache storage is billed per hour) and reports
 *   no cache-write tokens, so no cache-write rate is given.
 * - Audio input, priced higher on some models, is not modelled.
 */
export const GEMINI_CHAT_RATES: Readonly<Record<string, ModelRate>> = {
  "gemini-3.8-flash": {
    periods: [
      { input: 0.75, output: 3.75, cacheRead: 0.075 },
      { from: FLASH_DOUBLING_DAY, input: 1.5, output: 7.5, cacheRead: 0.15 },
    ],
  },
  "gemini-3.7-flash": {
    periods: [
      { input: 0.75, output: 3.75 },
      { from: FLASH_DOUBLING_DAY, input: 1.5, output: 7.5 },
    ],
  },
  "gemini-3.6-flash": {
    periods: [
      { input: 0.75, output: 3.75, cacheRead: 0.075 },
      { from: FLASH_DOUBLING_DAY, input: 1.5, output: 7.5, cacheRead: 0.15 },
    ],
  },
  "gemini-3.5-flash-lite": singleRate({ input: 0.3, output: 2.5, cacheRead: 0.03 }),
  "gemini-3.1-flash-lite": singleRate({ input: 0.25, output: 1.5, cacheRead: 0.025 }),
  "gemini-3.1-pro-preview": singleRate({
    input: 2,
    output: 12,
    cacheRead: 0.2,
    largePrompt: { overPromptTokens: 200_000, input: 4, output: 18, cacheRead: 0.4 },
  }),
};

const CATALOGUE_COSTS: Readonly<Record<string, ModelCost>> = Object.fromEntries(
  Object.values(GOOGLE_MODELS).map((model) => [model.id, model.cost as ModelCost]),
);

/**
 * The rate schedule of a Gemini chat model id, from `GEMINI_CHAT_RATES`.
 *
 * The API has served `-preview` ids for models the price page lists without the suffix, so a
 * `-preview` id the table does not list takes the rate of the id without it; a preview with its
 * own rate still matches itself first. Not in the table at all: Google's list price from pi-ai's
 * catalogue for that id (as one period). Neither: no rate.
 */
export function googleChatRate(modelId: string): ModelRate | undefined {
  return tableRate(modelId) ?? catalogueRate(CATALOGUE_COSTS[modelId]);
}

/** The table's rate for an id or, for a `-preview` id, for the id without the suffix. */
export function tableRate(modelId: string): ModelRate | undefined {
  const own = GEMINI_CHAT_RATES[modelId];
  if (own !== undefined) return own;
  const withoutPreview = modelId.replace(/-preview$/, "");
  return withoutPreview === modelId ? undefined : GEMINI_CHAT_RATES[withoutPreview];
}

/**
 * A pi-ai catalogue price as a one-period schedule. pi-ai's catalogue has no "unpublished", so a
 * zero cache rate is read as unpublished and a model priced at zero for both input and output has
 * no rate: an unknown price is never a zero price.
 */
function catalogueRate(cost: ModelCost | undefined): ModelRate | undefined {
  if (cost === undefined || (cost.input === 0 && cost.output === 0)) return undefined;
  const tier = cost.tiers?.[0];
  return singleRate({
    input: cost.input,
    output: cost.output,
    ...(cost.cacheRead > 0 ? { cacheRead: cost.cacheRead } : {}),
    ...(cost.cacheWrite > 0 ? { cacheWrite: cost.cacheWrite } : {}),
    ...(tier === undefined
      ? {}
      : {
          largePrompt: {
            overPromptTokens: tier.inputTokensAbove,
            input: tier.input,
            output: tier.output,
            ...(tier.cacheRead > 0 ? { cacheRead: tier.cacheRead } : {}),
            ...(tier.cacheWrite > 0 ? { cacheWrite: tier.cacheWrite } : {}),
          },
        }),
  });
}
