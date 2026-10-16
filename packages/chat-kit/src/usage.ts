import type { Usage } from "@earendil-works/pi-ai";
import type { ChatUsage } from "./types.ts";

/**
 * pi-ai's `Usage` as reported token counts. pi-ai's `input` excludes cache reads and writes, so
 * they are added back: `inputTokens` is every prompt token. pi-ai's `cost` is not carried over.
 */
export function toChatUsage(usage: Usage, raw: unknown): ChatUsage {
  return {
    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
    cachedInputTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
    totalTokens: usage.totalTokens,
    ...(raw === undefined ? {} : { raw }),
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
