import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { assertMarkerReplaced, assertNoMarker, renderTextDocument, spliceMarker, type PreparedDocument } from "../documents.ts";
import { TurnFailure } from "../errors.ts";
import { isRecord } from "../guards.ts";
import type { ChatUsage } from "../types.ts";
import { billingFields, tokenCount, toChatUsage } from "../usage.ts";
import { withFileParser } from "./openrouter.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

type AnthropicBlock = Record<string, unknown>;

/** `refusal` is Claude declining; `sensitive` is a safety-filter stop that pi-ai also passes through. */
const BLOCKED_STOP_REASONS = new Set(["refusal", "sensitive"]);

function anthropicBlock(document: PreparedDocument): AnthropicBlock {
  if (document.kind === "text") return { type: "text", text: renderTextDocument(document) };
  const source =
    document.source.type === "url"
      ? { type: "url", url: document.source.url }
      : { type: "base64", media_type: document.mimeType, data: document.source.data };
  return document.kind === "pdf" ? { type: "document", source, title: document.name } : { type: "image", source };
}

/**
 * pi-ai's own prompt-cache breakpoint, if it set one: with `cacheRetention` other than `"none"` it
 * marks the system prompt and the last block of the last user message (and the last tool, where
 * supported). Reusing that object keeps its TTL and stays off when caching is off.
 */
function findCacheControl(payload: Record<string, unknown>): unknown {
  const blocks = [
    ...(Array.isArray(payload.system) ? payload.system : []),
    ...(Array.isArray(payload.messages)
      ? payload.messages.flatMap((message) => (isRecord(message) && Array.isArray(message.content) ? message.content : []))
      : []),
  ];
  for (const block of blocks) {
    if (isRecord(block) && isRecord(block.cache_control)) return block.cache_control;
  }
  return undefined;
}

function thinkingEnabled(thinking: unknown): boolean {
  return isRecord(thinking) && thinking.type !== "disabled";
}

/**
 * Anthropic Messages (OpenRouter `anthropic/*`, KIE and ToAPIs Claude): documents replace the
 * marker block (`document` for PDFs, `image` for images), with one more cache breakpoint on the
 * last document block so the prefix up to the end of the documents is cached across turns. That
 * makes three breakpoints with pi-ai's two (system prompt, last user message), within Anthropic's
 * four. The response schema is a forced call of a single tool whose input schema is the schema.
 *
 * On OpenRouter the file-parser plugin is pinned to `native`, as on its Completions route: its
 * Anthropic-compatible `/v1/messages` takes the same `plugins` array
 * (https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message). KIE and
 * ToAPIs never get it.
 */
export function transformAnthropicPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload, ...(plan.targetsOpenRouter ? { plugins: withFileParser(payload.plugins) } : {}) };
  if (plan.marker !== undefined) {
    const marker = plan.marker;
    const replacement = plan.documents.map(anthropicBlock);
    const cacheControl = findCacheControl(payload);
    const last = replacement.length - 1;
    if (cacheControl !== undefined && last >= 0) replacement[last] = { ...replacement[last], cache_control: cacheControl };
    const counter = { found: 0 };
    const messages = Array.isArray(payload.messages) ? (payload.messages as Record<string, unknown>[]) : [];
    next.messages = messages.map((message) => {
      if (typeof message.content === "string") {
        assertNoMarker(message.content, marker);
        return message;
      }
      if (!Array.isArray(message.content)) return message;
      const content = spliceMarker(
        message.content as AnthropicBlock[],
        marker,
        (block) => (block.type === "text" && typeof block.text === "string" ? block.text : undefined),
        replacement,
        counter,
      );
      return { ...message, content };
    });
    assertMarkerReplaced(counter);
  }
  if (plan.responseSchema) {
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
 * Claude families that always think: Opus 5, Fable 5 and every 5.5 model. A point release or dated
 * snapshot (`claude-fable-5.1`, `claude-opus-5-20261001`) belongs to its family.
 */
const ALWAYS_THINKING_CLAUDE = /^claude-(?:(?:opus|fable)-5|[a-z]+-5-5)(?![0-9])/;

/**
 * Whether a model id names an always-thinking Claude family, whatever its catalogue entry says
 * (OpenRouter's `anthropic/claude-opus-5` lists thinking as `off: "none"`). The id is matched
 * without a provider prefix such as `anthropic/`, and with `.` read as `-`, so KIE's
 * `claude-opus-5`, OpenRouter's `anthropic/claude-opus-5` and `anthropic/claude-sonnet-5.5` match.
 */
export function isAlwaysThinkingClaude(modelId: string): boolean {
  const id = modelId
    .slice(modelId.lastIndexOf("/") + 1)
    .toLowerCase()
    .replaceAll(".", "-");
  return ALWAYS_THINKING_CLAUDE.test(id);
}

/**
 * A forced tool call is incompatible with thinking. That rules out a requested reasoning level,
 * and models that always think: by catalogue metadata, pi-ai's managed-effort models
 * (`supportsMidConvoEffort`) and models whose thinking cannot be turned off
 * (`thinkingLevelMap.off === null`); by model id, the always-thinking Claude families, which a
 * provider's catalogue may not mark.
 */
export function anthropicSchemaUnsupported(
  model: Model<Api>,
  request: { responseSchema: unknown; settings: { reasoning?: unknown } },
): string | undefined {
  if (!request.responseSchema) return undefined;
  if (request.settings.reasoning !== undefined) {
    return "a response schema on Anthropic Messages is a forced tool call, which Anthropic does not allow with thinking; remove settings.reasoning.";
  }
  const compat = (model as { compat?: { supportsMidConvoEffort?: boolean } }).compat;
  const alwaysThinks = compat?.supportsMidConvoEffort === true || model.thinkingLevelMap?.off === null || isAlwaysThinkingClaude(model.id);
  if (alwaysThinks) {
    return "a response schema on Anthropic Messages is a forced tool call, which Anthropic does not allow with thinking, and this model always thinks.";
  }
  return undefined;
}

/**
 * The Messages usage object: `input_tokens` excludes cache reads (`cache_read_input_tokens`) and
 * writes (`cache_creation_input_tokens`), so `inputTokens` adds the ones reported. Anthropic
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
      input: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
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
  let usage: Record<string, unknown> | undefined;
  let billing: Record<string, unknown> = {};
  const merge = (next: unknown, container: Record<string, unknown>) => {
    if (isRecord(next)) {
      const reported = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined));
      usage = { ...usage, ...reported };
    }
    billing = { ...billing, ...billingFields(container) };
  };
  return {
    observe(event) {
      if (!isRecord(event)) return;
      if (event.type === "message_start" && isRecord(event.message)) merge(event.message.usage, event.message);
      else if (event.type === "message_delta") merge(event.usage, event);
    },
    usage: () => anthropicUsage(usage ?? {}, usage === undefined ? billing : { usage, ...billing }),
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
  acceptsFetch: true,
  schemaAsToolCall: true,
  placeDocument: (document) => (document.url === undefined ? "inline" : "url"),
  unsupported: anthropicSchemaUnsupported,
  transform: transformAnthropicPayload,
  createObserver: createAnthropicObserver,
};
