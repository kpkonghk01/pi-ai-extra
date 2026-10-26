import { calculateCost, type ImageApi, type ImageModel, type Usage } from "@earendil-works/pi-ai";
import type { ImageTokenUsage } from "../usage.ts";

/**
 * Converts provider-reported tokens to pi-ai's `Usage`, following pi-ai's own chat
 * adapters: `input` excludes cached tokens, `cacheRead` carries them, `output` includes
 * reasoning and `reasoning` is its subset. pi-ai's `Usage` requires every counter, so
 * counters the provider does not report (cache writes) are 0 here as in pi-ai's
 * adapters; the raw `ImageGenerationResult.usage` keeps them omitted.
 * Returns undefined unless the provider reported input or output token counts.
 */
export function toPiAiUsage(model: ImageModel<ImageApi>, tokens: ImageTokenUsage | undefined): Usage | undefined {
  // A total alone cannot be split into input/output without inventing numbers.
  if (!tokens || (tokens.input === undefined && tokens.output === undefined)) return undefined;
  const cacheRead = tokens.cachedInput ?? 0;
  const input = Math.max(0, (tokens.input ?? 0) - cacheRead);
  const output = (tokens.output ?? 0) + (tokens.reasoning ?? 0);
  const usage: Usage = {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    ...(tokens.reasoning === undefined ? {} : { reasoning: tokens.reasoning }),
    totalTokens: tokens.total ?? input + output + cacheRead,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  // Image models carry zero per-token rates; consumers price image tasks from `credits`/`costUsd`.
  return { ...usage, cost: calculateCost(model, usage) };
}

/** A fresh zero-filled pi-ai `Usage`: a message pi-ai did not produce still needs one, and pi-ai may update it in place. */
export function zeroUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}
