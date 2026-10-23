import { isRecord } from "@hk01/pi-ai-extra-internal/util";
import type { ChatUsage } from "../types.ts";
import { tokenCount, toChatUsage } from "../usage.ts";
import type { BlockedTurn } from "./types.ts";

/** A turn stopped by the provider's content filter: `content_filter` on both OpenAI APIs. */
export const CONTENT_FILTER_BLOCK: BlockedTurn = {
  reason: "content_filter",
  message: "The provider's content filter stopped the answer (content_filter).",
};

/** The headers the OpenAI SDK would add from `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID`: never sent (ADR 0003, no ambient configuration). */
export const OPENAI_AMBIENT_HEADERS: Readonly<Record<string, null>> = { "OpenAI-Organization": null, "OpenAI-Project": null };

/** Where an OpenAI usage object keeps the prompt and answer counts and their details. */
export interface OpenAIUsageFields {
  input: string;
  inputDetails: string;
  output: string;
  outputDetails: string;
}

/** Chat Completions usage fields. */
export const COMPLETIONS_USAGE_FIELDS: OpenAIUsageFields = {
  input: "prompt_tokens",
  inputDetails: "prompt_tokens_details",
  output: "completion_tokens",
  outputDetails: "completion_tokens_details",
};

/** Responses usage fields. */
export const RESPONSES_USAGE_FIELDS: OpenAIUsageFields = {
  input: "input_tokens",
  inputDetails: "input_tokens_details",
  output: "output_tokens",
  outputDetails: "output_tokens_details",
};

/**
 * An OpenAI usage object, Chat Completions or Responses (`fields` names which): the prompt count
 * already includes cache reads (`cached_tokens` in the input details) and, where a provider
 * reports them, cache writes (`cache_write_tokens` there); the answer count includes
 * `reasoning_tokens` from the output details.
 */
export function openAIUsage(
  usage: Record<string, unknown>,
  raw: Record<string, unknown>,
  fields: OpenAIUsageFields,
): ChatUsage | undefined {
  const inputDetails = usage[fields.inputDetails];
  const outputDetails = usage[fields.outputDetails];
  const input = isRecord(inputDetails) ? inputDetails : {};
  const output = isRecord(outputDetails) ? outputDetails : {};
  return toChatUsage(
    {
      prompt: tokenCount(usage[fields.input]),
      output: tokenCount(usage[fields.output]),
      total: tokenCount(usage.total_tokens),
      cacheRead: tokenCount(input.cached_tokens),
      cacheWrite: tokenCount(input.cache_write_tokens),
      reasoning: tokenCount(output.reasoning_tokens),
    },
    raw,
  );
}
