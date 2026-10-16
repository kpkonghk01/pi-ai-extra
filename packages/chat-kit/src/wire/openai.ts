import { isRecord } from "../guards.ts";
import type { ChatUsage } from "../types.ts";
import { tokenCount, toChatUsage } from "../usage.ts";
import type { BlockedTurn } from "./types.ts";

/** A turn stopped by the provider's content filter: `content_filter` on both OpenAI APIs. */
export const CONTENT_FILTER_BLOCK: BlockedTurn = {
  reason: "content_filter",
  message: "The provider's content filter stopped the answer (content_filter).",
};

/** The prompt and answer count fields of an OpenAI usage object: Chat Completions or Responses. */
export interface OpenAIUsageFields {
  /** `prompt_tokens` (Completions) or `input_tokens` (Responses); its details are under `<field>_details`. */
  input: "prompt_tokens" | "input_tokens";
  /** `completion_tokens` (Completions) or `output_tokens` (Responses); its details are under `<field>_details`. */
  output: "completion_tokens" | "output_tokens";
}

/**
 * An OpenAI usage object, Chat Completions or Responses: the prompt count already includes cache
 * reads (`<input>_details.cached_tokens`) and, where a provider reports them, cache writes
 * (`<input>_details.cache_write_tokens`); the answer count includes
 * `<output>_details.reasoning_tokens`.
 */
export function openAIUsage(
  usage: Record<string, unknown>,
  raw: Record<string, unknown>,
  fields: OpenAIUsageFields,
): ChatUsage | undefined {
  const inputDetails = usage[`${fields.input}_details`];
  const outputDetails = usage[`${fields.output}_details`];
  const input = isRecord(inputDetails) ? inputDetails : {};
  const output = isRecord(outputDetails) ? outputDetails : {};
  return toChatUsage(
    {
      input: tokenCount(usage[fields.input]),
      output: tokenCount(usage[fields.output]),
      total: tokenCount(usage.total_tokens),
      cacheRead: tokenCount(input.cached_tokens),
      cacheWrite: tokenCount(input.cache_write_tokens),
      reasoning: tokenCount(output.reasoning_tokens),
    },
    raw,
  );
}
