import type { AssistantMessage } from "@earendil-works/pi-ai";
import { assertMarkerReplaced, assertNoMarker, dataUrl, renderTextDocument, spliceMarker, type PreparedDocument } from "../documents.ts";
import { isRecord } from "../guards.ts";
import { billingFields } from "../usage.ts";
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

/** `finish_reason: "content_filter"` is the block; usage (with OpenRouter's `cost`) is on the last chunk. */
export function createOpenAICompletionsObserver(): StreamObserver {
  let raw: Record<string, unknown> | undefined;
  return {
    observe(chunk) {
      if (!isRecord(chunk) || !isRecord(chunk.usage)) return;
      raw = { usage: chunk.usage, ...billingFields(chunk) };
    },
    rawUsage: () => raw,
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
