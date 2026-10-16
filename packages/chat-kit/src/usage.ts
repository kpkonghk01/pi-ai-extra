import type { ChatUsage } from "./types.ts";

/** A token count as the provider reported it: a non-negative integer, otherwise not reported. */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The counts one wire API read from its provider's raw usage record; undefined means not reported. */
export interface ReportedCounts {
  /** Every prompt token, cache reads and writes included. */
  input: number | undefined;
  /** Every generated token, reasoning included. */
  output: number | undefined;
  /** The provider's own total, when it reports one. */
  total?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
  reasoning?: number | undefined;
}

/**
 * The turn's `ChatUsage`, from what the provider reported and nothing else: a count it did not
 * report is omitted, never set to zero (ADR 0005). Without both a prompt and an answer count
 * there is no usage record, so the turn carries none, just as a usage block with an unexpected
 * shape is dropped rather than failing a finished turn.
 */
export function toChatUsage(counts: ReportedCounts, raw: Record<string, unknown>): ChatUsage | undefined {
  const { input, output } = counts;
  if (input === undefined || output === undefined) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    ...(counts.cacheRead === undefined ? {} : { cachedInputTokens: counts.cacheRead }),
    ...(counts.cacheWrite === undefined ? {} : { cacheWriteTokens: counts.cacheWrite }),
    ...(counts.reasoning === undefined ? {} : { reasoningTokens: counts.reasoning }),
    totalTokens: counts.total ?? input + output,
    raw,
  };
}

const BILLING_FIELD = /cost|credit/i;

/**
 * Cost or credit fields a provider reports next to its usage object (for example KIE's
 * `credits_consumed`), so raw usage keeps them without the response content.
 */
export function billingFields(container: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(container)) {
    if (key !== "usage" && BILLING_FIELD.test(key) && value !== null && value !== undefined) fields[key] = value;
  }
  return fields;
}
