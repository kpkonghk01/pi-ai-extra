import { calculateCost, type Api, type ImagesModel, type Model, type Usage } from "@earendil-works/pi-ai";
import type { ImageTokenUsage } from "../usage.ts";

/**
 * Converts provider-reported tokens to pi-ai's `Usage`, following pi-ai 0.87.1's own
 * adapters: `input` excludes cached tokens, `cacheRead` carries them, `output` includes
 * reasoning and `reasoning` is its subset. pi-ai's `Usage` requires every counter, so
 * counters the provider does not report (cache writes) are 0 here as in pi-ai's
 * adapters; the raw `ImageGenerationResult.usage` keeps them omitted.
 * Returns undefined when the provider reported no token counts at all.
 */
export function toPiAiUsage(model: ImagesModel<string>, tokens: ImageTokenUsage | undefined): Usage | undefined {
  if (!tokens || (tokens.input === undefined && tokens.output === undefined && tokens.total === undefined)) return undefined;
  const cacheRead = tokens.cachedInput ?? 0;
  const input = Math.max(0, (tokens.input ?? 0) - cacheRead);
  const output = (tokens.output ?? 0) + (tokens.reasoning ?? 0);
  const usage: Usage = {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: tokens.total ?? input + output + cacheRead,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  if (tokens.reasoning !== undefined) usage.reasoning = tokens.reasoning;
  // Image models carry zero per-token rates; consumers price image tasks from `credits`/`costUsd`.
  return { ...usage, cost: calculateCost(model as unknown as Model<Api>, usage) };
}
