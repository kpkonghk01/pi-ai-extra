import { isRecord } from "./guards.ts";
import type { ChatUsage } from "./types.ts";

/** A token count as the provider reported it: a non-negative integer, otherwise not reported. */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The sum of the counts the provider reported; undefined when it reported none of them. */
export function sumReported(...counts: readonly (number | undefined)[]): number | undefined {
  const reported = counts.filter((count): count is number => count !== undefined);
  return reported.length === 0 ? undefined : reported.reduce((sum, count) => sum + count, 0);
}

/** The counts one wire API read from its provider's raw usage record; undefined means not reported. */
export interface ReportedCounts {
  /** Every prompt token: cache reads and writes included, and Gemini's tool-use prompt tokens. */
  input?: number | undefined;
  /** Every generated token, reasoning included. */
  output?: number | undefined;
  /** The provider's own total, when it reports one. Never computed. */
  total?: number | undefined;
  cacheRead?: number | undefined;
  cacheWrite?: number | undefined;
  reasoning?: number | undefined;
}

/**
 * The turn's `ChatUsage`, from what the provider reported and nothing else (ADR 0005): a count it
 * did not report is omitted, never estimated or set to zero, and `totalTokens` is only the
 * provider's own total. Any reported count, or a cost or credit in `raw`, makes a usage record,
 * which keeps `raw`. With neither, the turn carries no usage, just as a usage block with an
 * unexpected shape is dropped rather than failing a finished turn.
 */
export function toChatUsage(counts: ReportedCounts, raw: Record<string, unknown>): ChatUsage | undefined {
  const reported = {
    ...(counts.input === undefined ? {} : { inputTokens: counts.input }),
    ...(counts.output === undefined ? {} : { outputTokens: counts.output }),
    ...(counts.cacheRead === undefined ? {} : { cachedInputTokens: counts.cacheRead }),
    ...(counts.cacheWrite === undefined ? {} : { cacheWriteTokens: counts.cacheWrite }),
    ...(counts.reasoning === undefined ? {} : { reasoningTokens: counts.reasoning }),
    ...(counts.total === undefined ? {} : { totalTokens: counts.total }),
  };
  if (Object.keys(reported).length === 0 && !reportsBilling(raw)) return undefined;
  return { ...reported, raw };
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

/**
 * Whether raw usage holds a cost or credit the provider reported: beside its usage record (KIE
 * `credits_consumed`) or inside it (OpenRouter `usage.cost`).
 */
function reportsBilling(raw: Record<string, unknown>): boolean {
  const billed = (container: Record<string, unknown>) => Object.keys(billingFields(container)).length > 0;
  return billed(raw) || Object.values(raw).some((value) => isRecord(value) && billed(value));
}
