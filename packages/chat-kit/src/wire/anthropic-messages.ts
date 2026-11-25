import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { modelIdKey } from "@hk01/pi-ai-extra-internal/model-id";
import { TurnFailure } from "../errors.ts";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";
import type { ChatUsage } from "../types.ts";
import { createUsageCapture, tokenCount, toChatUsage } from "../usage.ts";
import { sanitizeSchemaForAnthropic } from "./anthropic-schema.ts";
import { encodeDocument, placeByUrl, replaceDocumentMarker, textOfType, type DocumentEncoder } from "./document-parts.ts";
import { openRouterPlugins } from "./openrouter.ts";
import type { BlockedTurn, PayloadPlan, SchemaRequest, StreamObserver, WireApi } from "./types.ts";

type AnthropicBlock = Record<string, unknown>;

/** `refusal` is Claude declining; `sensitive` is a safety-filter stop that pi-ai also passes through. */
const BLOCKED_STOP_REASONS = new Set(["refusal", "sensitive"]);

/** `document` for PDFs, `image` for images; both take a URL or a base64 source. */
const ANTHROPIC_BLOCKS: DocumentEncoder<AnthropicBlock, AnthropicBlock> = {
  text: (text) => ({ type: "text", text }),
  url: (url) => ({ type: "url", url }),
  inline: (data, document) => ({ type: "base64", media_type: document.mimeType, data }),
  pdf: (source, document) => ({ type: "document", source, title: document.name }),
  image: (source) => ({ type: "image", source }),
};

/**
 * Every block of the request that can carry a cache breakpoint: the system blocks, the tools and
 * the blocks of each message.
 */
function cacheableBlocks(payload: Record<string, unknown>): unknown[] {
  return [
    ...(Array.isArray(payload.system) ? payload.system : []),
    ...(Array.isArray(payload.tools) ? payload.tools : []),
    ...(Array.isArray(payload.messages)
      ? payload.messages.flatMap((message) => (isRecord(message) && Array.isArray(message.content) ? message.content : []))
      : []),
  ];
}

/** The blocks of the request that carry a cache breakpoint. */
function breakpointBlocks(payload: Record<string, unknown>): Record<string, unknown>[] {
  return cacheableBlocks(payload).filter((block): block is Record<string, unknown> => isRecord(block) && isRecord(block.cache_control));
}

/**
 * pi-ai's own prompt-cache breakpoint, if it set one: with `cacheRetention` other than `"none"` it
 * marks the system prompt, the last tool (where the provider supports it) and the last block of the
 * last user message. Reusing that object keeps its TTL and stays off when caching is off.
 */
function findCacheControl(payload: Record<string, unknown>): unknown {
  return breakpointBlocks(payload)[0]?.cache_control;
}

/** Anthropic allows at most four cache breakpoints in one request; a fifth is a 400. */
const MAX_CACHE_BREAKPOINTS = 4;

/** How many cache breakpoints the request already has. */
function countCacheBreakpoints(payload: Record<string, unknown>): number {
  return breakpointBlocks(payload).length;
}

function thinkingEnabled(thinking: unknown): boolean {
  return isRecord(thinking) && thinking.type !== "disabled";
}

/**
 * Anthropic Messages (OpenRouter `anthropic/*`, KIE and ToAPIs Claude): documents replace the
 * marker block (`document` for PDFs, `image` for images), with one more cache breakpoint on the
 * last document block so the prefix up to the end of the documents is cached across turns. pi-ai
 * sets up to three (system prompt, last tool, last user message), so that is at most Anthropic's
 * four; the kit adds its own only while the request has fewer than four, so a breakpoint pi-ai adds
 * later cannot push it over. The response schema is a forced call of a single tool whose input schema is the schema;
 * when the model thinks and the provider takes native structured output, it is
 * `output_config.format` instead (beside pi-ai's own `output_config`, such as its effort).
 *
 * On OpenRouter the file-parser plugin is pinned to `native`, as on its Completions route: its
 * Anthropic-compatible `/v1/messages` takes the same `plugins` array
 * (https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message). KIE and
 * ToAPIs never get it.
 */
export function transformAnthropicPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload, ...openRouterPlugins(payload, plan) };
  if (plan.marker !== undefined) {
    const replacement = plan.documents.map((document) => encodeDocument(document, ANTHROPIC_BLOCKS));
    const cacheControl = findCacheControl(payload);
    const last = replacement.length - 1;
    if (cacheControl !== undefined && last >= 0 && countCacheBreakpoints(payload) < MAX_CACHE_BREAKPOINTS) replacement[last] = { ...replacement[last], cache_control: cacheControl };
    next.messages = replaceDocumentMarker(payload.messages, plan.marker, replacement, { partsKey: "content", textOf: textOfType("text") });
  }
  if (plan.responseSchema && plan.nativeStructuredOutput) {
    // Native structured output constrains the answer text only; the model still thinks freely.
    // https://platform.claude.com/docs/en/build-with-claude/structured-outputs
    next.output_config = {
      ...(isRecord(payload.output_config) ? payload.output_config : {}),
      format: { type: "json_schema", schema: sanitizeSchemaForAnthropic(plan.responseSchema.schema) },
    };
  } else if (plan.responseSchema) {
    // Anthropic rejects a forced tool call while thinking is on; `unsupported()` catches the
    // known cases before any document is loaded, this guards the payload itself.
    if (thinkingEnabled(payload.thinking)) {
      throw new TurnFailure("UNSUPPORTED", "Anthropic Messages cannot force the response-schema tool call while thinking is on.");
    }
    const { name, schema } = plan.responseSchema;
    next.tools = [
      ...(Array.isArray(payload.tools) ? payload.tools : []),
      { name, description: "Respond with the answer as this tool's input.", input_schema: schema },
    ];
    next.tool_choice = { type: "tool", name };
  }
  return next;
}

/**
 * Claude families that always think, as pi-ai's catalogue marks them (thinking `off: null`): Fable 5,
 * Opus 5.5 and Sonnet 5.5. Opus 5 and Haiku 5.5 turn thinking off since pi-ai 1.3.0. A point release
 * or dated snapshot (`claude-fable-5.1`, `claude-fable-5-2-20261101`) belongs to its family.
 */
const ALWAYS_THINKING_CLAUDE = /^claude-(?:fable-5|opus-5-5|sonnet-5-5)(?![0-9])/;

/**
 * Whether a model id names an always-thinking Claude family. The id is matched without a provider
 * prefix such as `anthropic/`, and with `.` read as `-`, so KIE's `claude-opus-5-5` and
 * OpenRouter's `anthropic/claude-sonnet-5.5` match.
 */
export function isAlwaysThinkingClaude(modelId: string): boolean {
  return ALWAYS_THINKING_CLAUDE.test(modelIdKey(modelId.slice(modelId.lastIndexOf("/") + 1)));
}

/**
 * Whether the model always thinks, as pi-ai decides it: its thinking cannot be turned off
 * (`thinkingLevelMap.off === null`), so pi-ai never sends `thinking: { type: "disabled" }`. A
 * model with no thinking levels, which pi-ai's catalogue does not know, is judged by its id.
 */
function alwaysThinks(model: Model<Api>): boolean {
  return model.thinkingLevelMap ? model.thinkingLevelMap.off === null : isAlwaysThinkingClaude(model.id);
}

/**
 * A response schema is a forced tool call, which Anthropic does not allow while the model
 * thinks: with a requested reasoning level, or on a model that always thinks. There it goes as
 * native structured output instead, where the provider takes it (`nativeStructuredOutput`).
 */
export function anthropicSchemaUnsupported(model: Model<Api>, request: SchemaRequest): string | undefined {
  if (!request.responseSchema || request.nativeStructuredOutput) return undefined;
  if (request.reasoning !== undefined) {
    return "a response schema on Anthropic Messages is a forced tool call, which Anthropic does not allow with thinking, and this provider does not take native structured output yet; remove the reasoning option.";
  }
  if (alwaysThinks(model)) {
    return "a response schema on Anthropic Messages is a forced tool call, which Anthropic does not allow with thinking, and this model always thinks; this provider does not take native structured output yet.";
  }
  return undefined;
}

/** A forced tool call unless the model thinks during the turn and the provider takes native structured output. */
function anthropicSchemaAsToolCall(model: Model<Api>, request: SchemaRequest): boolean {
  const thinks = request.reasoning !== undefined || alwaysThinks(model);
  return !(thinks && request.nativeStructuredOutput);
}

/**
 * The Messages usage object: `input_tokens` excludes cache reads (`cache_read_input_tokens`) and
 * writes (`cache_creation_input_tokens`): it is `ChatUsage.input` as it stands (the prompt is the
 * three added up, and `toChatUsage` takes the cache counts back off). Anthropic
 * reports no total, so `totalTokens` is omitted, and reasoning only as
 * `output_tokens_details.thinking_tokens` where a proxy passes it on.
 */
function anthropicUsage(usage: Record<string, unknown>, raw: Record<string, unknown>): ChatUsage | undefined {
  const input = tokenCount(usage.input_tokens);
  const cacheRead = tokenCount(usage.cache_read_input_tokens);
  const cacheWrite = tokenCount(usage.cache_creation_input_tokens);
  const output = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return toChatUsage(
    {
      prompt: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
      output: tokenCount(usage.output_tokens),
      cacheRead,
      cacheWrite,
      reasoning: tokenCount(output.thinking_tokens),
    },
    raw,
  );
}

/**
 * Usage is `message_start.message.usage` overlaid with `message_delta.usage` (pi-ai's own rule);
 * cost or credit fields on either event are kept, with or without a usage object beside them
 * (KIE reports `credits_consumed`).
 */
export function createAnthropicObserver(): StreamObserver {
  const capture = createUsageCapture();
  const merge = (usage: unknown, container: Record<string, unknown>) => {
    if (isRecord(usage)) capture.overlay(usage);
    capture.addBilling(container);
  };
  return {
    observe(event) {
      if (!isRecord(event)) return;
      if (event.type === "message_start" && isRecord(event.message)) merge(event.message.usage, event.message);
      else if (event.type === "message_delta") merge(event.usage, event);
    },
    usage: () => capture.read(anthropicUsage),
    blocked(message: AssistantMessage): BlockedTurn | undefined {
      const reason = message.rawStopReason;
      if (reason === undefined || !BLOCKED_STOP_REASONS.has(reason)) return undefined;
      const detail = message.errorMessage ? `: ${message.errorMessage}` : "";
      return { reason, message: `Claude stopped with ${reason}${detail}` };
    },
  };
}

export const ANTHROPIC_MESSAGES_WIRE_API: WireApi = {
  api: "anthropic-messages",
  schemaAsToolCall: anthropicSchemaAsToolCall,
  placeDocument: placeByUrl,
  unsupported: anthropicSchemaUnsupported,
  transform: transformAnthropicPayload,
  createObserver: createAnthropicObserver,
};
