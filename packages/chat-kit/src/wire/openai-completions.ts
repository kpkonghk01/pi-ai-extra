import type { AssistantMessage } from "@earendil-works/pi-ai";
import { assertMarkerReplaced, assertNoMarker, dataUrl, renderTextDocument, spliceMarker, type PreparedDocument } from "../documents.ts";
import { isRecord } from "../guards.ts";
import type { ChatUsage } from "../types.ts";
import { billingFields, tokenCount, toChatUsage } from "../usage.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

type CompletionsPart = Record<string, unknown>;

/**
 * OpenRouter's PDF parser pinned to the model's native file input, so a PDF never falls
 * through to the paid OCR engine.
 */
export const OPENROUTER_FILE_PARSER = { id: "file-parser", pdf: { engine: "native" } } as const;

function completionsPart(document: PreparedDocument): CompletionsPart {
  if (document.kind === "text") return { type: "text", text: renderTextDocument(document) };
  const url = document.source.type === "url" ? document.source.url : dataUrl(document.mimeType, document.source.data);
  return document.kind === "pdf"
    ? { type: "file", file: { filename: document.name, file_data: url } }
    : { type: "image_url", image_url: { url } };
}

function withFileParser(plugins: unknown): unknown[] {
  const others = Array.isArray(plugins) ? plugins.filter((plugin) => !(isRecord(plugin) && plugin.id === "file-parser")) : [];
  return [...others, OPENROUTER_FILE_PARSER];
}

/**
 * OpenAI Chat Completions (OpenRouter): documents replace the marker part (`file` for PDFs,
 * `image_url` for images), the file-parser plugin is always pinned to `native`, and the
 * response schema becomes a strict `response_format`. With a schema, OpenRouter is asked to route
 * only to endpoints that honour it (`provider.require_parameters`), so an endpoint that would
 * ignore the schema fails instead.
 */
export function transformOpenAICompletionsPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload, plugins: withFileParser(payload.plugins) };
  if (plan.marker !== undefined) {
    const marker = plan.marker;
    const replacement = plan.documents.map(completionsPart);
    const counter = { found: 0 };
    const messages = Array.isArray(payload.messages) ? (payload.messages as Record<string, unknown>[]) : [];
    next.messages = messages.map((message) => {
      if (typeof message.content === "string") {
        assertNoMarker(message.content, marker);
        return message;
      }
      if (!Array.isArray(message.content)) return message;
      const content = spliceMarker(
        message.content as CompletionsPart[],
        marker,
        (part) => (part.type === "text" && typeof part.text === "string" ? part.text : undefined),
        replacement,
        counter,
      );
      return { ...message, content };
    });
    assertMarkerReplaced(counter);
  }
  if (plan.responseSchema) {
    next.response_format = {
      type: "json_schema",
      json_schema: { name: plan.responseSchema.name, schema: plan.responseSchema.schema, strict: true },
    };
    next.provider = { ...(isRecord(payload.provider) ? payload.provider : {}), require_parameters: true };
  }
  return next;
}

/**
 * OpenRouter's usage object: `prompt_tokens` already includes cache reads
 * (`prompt_tokens_details.cached_tokens`) and writes (`prompt_tokens_details.cache_write_tokens`),
 * and `completion_tokens` includes `completion_tokens_details.reasoning_tokens`.
 */
function completionsUsage(usage: Record<string, unknown>, raw: Record<string, unknown>): ChatUsage | undefined {
  const prompt = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completion = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  return toChatUsage(
    {
      input: tokenCount(usage.prompt_tokens),
      output: tokenCount(usage.completion_tokens),
      total: tokenCount(usage.total_tokens),
      cacheRead: tokenCount(prompt.cached_tokens),
      cacheWrite: tokenCount(prompt.cache_write_tokens),
      reasoning: tokenCount(completion.reasoning_tokens),
    },
    raw,
  );
}

/** `finish_reason: "content_filter"` is the block; usage (with OpenRouter's `cost`) is on the last chunk. */
export function createOpenAICompletionsObserver(): StreamObserver {
  let usage: Record<string, unknown> | undefined;
  let raw: Record<string, unknown> = {};
  return {
    observe(chunk) {
      if (!isRecord(chunk) || !isRecord(chunk.usage)) return;
      usage = chunk.usage;
      raw = { usage, ...billingFields(chunk) };
    },
    usage: () => (usage === undefined ? undefined : completionsUsage(usage, raw)),
    blocked(message: AssistantMessage): BlockedTurn | undefined {
      return message.rawStopReason === "content_filter"
        ? { reason: "content_filter", message: "The provider's content filter stopped the answer (content_filter)." }
        : undefined;
    },
  };
}

export const OPENAI_COMPLETIONS_WIRE_API: WireApi = {
  api: "openai-completions",
  acceptsFetch: true,
  schemaAsToolCall: false,
  placeDocument: (document) => (document.url === undefined ? "inline" : "url"),
  unsupported: () => undefined,
  transform: transformOpenAICompletionsPayload,
  createObserver: createOpenAICompletionsObserver,
};
