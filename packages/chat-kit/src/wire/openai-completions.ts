import type { AssistantMessage } from "@earendil-works/pi-ai";
import { dataUrl } from "../documents.ts";
import { isRecord } from "../guards.ts";
import { createUsageCapture } from "../usage.ts";
import { encodeDocument, placeByUrl, replaceDocumentMarker, textOfType, type DocumentEncoder } from "./document-parts.ts";
import { COMPLETIONS_USAGE_FIELDS, CONTENT_FILTER_BLOCK, openAIUsage } from "./openai.ts";
import { withFileParser } from "./openrouter.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

type CompletionsPart = Record<string, unknown>;

/** `file` for PDFs, `image_url` for images; both take a URL or a data URL. */
const COMPLETIONS_PARTS: DocumentEncoder<CompletionsPart, string> = {
  text: (text) => ({ type: "text", text }),
  url: (url) => url,
  inline: (data, document) => dataUrl(document.mimeType, data),
  pdf: (url, document) => ({ type: "file", file: { filename: document.name, file_data: url } }),
  image: (url) => ({ type: "image_url", image_url: { url } }),
};

/**
 * OpenAI Chat Completions (OpenRouter, the only provider of the kit on this API): documents replace
 * the marker part (`file` for PDFs, `image_url` for images), the file-parser plugin is always
 * pinned to `native`, and the
 * response schema becomes a strict `response_format`. With a schema, OpenRouter is asked to route
 * only to endpoints that honour it (`provider.require_parameters`), so an endpoint that would
 * ignore the schema fails instead.
 */
export function transformOpenAICompletionsPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload, plugins: withFileParser(payload.plugins) };
  if (plan.marker !== undefined) {
    const replacement = plan.documents.map((document) => encodeDocument(document, COMPLETIONS_PARTS));
    next.messages = replaceDocumentMarker(payload.messages, plan.marker, replacement, { partsKey: "content", textOf: textOfType("text") });
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
 * `finish_reason: "content_filter"` is the block; usage (with OpenRouter's `cost`) is on the last
 * chunk, and any cost or credit field beside it is kept, with or without a usage object.
 */
export function createOpenAICompletionsObserver(): StreamObserver {
  const capture = createUsageCapture();
  return {
    observe(chunk) {
      if (!isRecord(chunk)) return;
      if (isRecord(chunk.usage)) capture.replace(chunk.usage);
      capture.addBilling(chunk);
    },
    usage: () => capture.read((usage, raw) => openAIUsage(usage, raw, COMPLETIONS_USAGE_FIELDS)),
    blocked(message: AssistantMessage): BlockedTurn | undefined {
      return message.rawStopReason === "content_filter" ? CONTENT_FILTER_BLOCK : undefined;
    },
  };
}

export const OPENAI_COMPLETIONS_WIRE_API: WireApi = {
  api: "openai-completions",
  acceptsFetch: true,
  schemaAsToolCall: false,
  placeDocument: placeByUrl,
  unsupported: () => undefined,
  transform: transformOpenAICompletionsPayload,
  createObserver: createOpenAICompletionsObserver,
};
