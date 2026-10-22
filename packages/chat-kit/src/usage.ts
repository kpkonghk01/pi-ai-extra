import { isRecord } from "@hk01/pi-ai-extra-internal/util";
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
  /** The whole prompt: cache reads and writes included, and Gemini's tool-use prompt tokens. */
  prompt?: number | undefined;
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
 * provider's own total. `input` is derived, the reported prompt count minus the reported cache
 * counts, and left out when negative. Any reported count, or a cost or credit in `raw`, makes a
 * usage record, which keeps `raw`. With neither, the turn carries no usage, just as a usage block
 * with an unexpected shape is dropped rather than failing a finished turn.
 */
export function toChatUsage(counts: ReportedCounts, raw: Record<string, unknown>): ChatUsage | undefined {
  const input = counts.prompt === undefined ? undefined : counts.prompt - (counts.cacheRead ?? 0) - (counts.cacheWrite ?? 0);
  const reported = {
    ...(input === undefined || input < 0 ? {} : { input }),
    ...(counts.output === undefined ? {} : { output: counts.output }),
    ...(counts.cacheRead === undefined ? {} : { cacheRead: counts.cacheRead }),
    ...(counts.cacheWrite === undefined ? {} : { cacheWrite: counts.cacheWrite }),
    ...(counts.reasoning === undefined ? {} : { reasoning: counts.reasoning }),
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

/**
 * Collects a turn's raw usage record and the cost or credit fields reported next to it, from the
 * provider's stream events, as one wire's observer sees them.
 */
export interface UsageCapture {
  /** Replaces the usage object with the latest one the provider sent (OpenAI APIs). */
  replace(usage: Record<string, unknown>): void;
  /** Overlays the counts the provider sent on the ones before, ignoring `null` (Anthropic Messages). */
  overlay(usage: Record<string, unknown>): void;
  /** Keeps the cost or credit fields of the event or object around the usage record. */
  addBilling(container: Record<string, unknown>): void;
  /**
   * The turn's usage from what was captured: `toUsage` reads the counts from the usage object
   * (`{}` when none was sent); `raw` is `{ usage, ...billing }`, or the billing fields alone.
   */
  read(toUsage: (usage: Record<string, unknown>, raw: Record<string, unknown>) => ChatUsage | undefined): ChatUsage | undefined;
}

export function createUsageCapture(): UsageCapture {
  let usage: Record<string, unknown> | undefined;
  let billing: Record<string, unknown> = {};
  return {
    replace(next) {
      usage = next;
    },
    overlay(next) {
      const reported = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined));
      usage = { ...usage, ...reported };
    },
    addBilling(container) {
      billing = { ...billing, ...billingFields(container) };
    },
    read: (toUsage) => toUsage(usage ?? {}, usage === undefined ? billing : { usage, ...billing }),
  };
}
