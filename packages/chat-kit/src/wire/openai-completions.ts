import type { AssistantMessage } from "@earendil-works/pi-ai";
import { dataUrl } from "../documents.ts";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";
import { createUsageCapture } from "../usage.ts";
import { encodeDocument, placeByUrl, replaceDocumentMarker, textOfType, type DocumentEncoder } from "./document-parts.ts";
import { sanitizeSchemaForGemini } from "./gemini-schema.ts";
import { COMPLETIONS_USAGE_FIELDS, CONTENT_FILTER_BLOCK, OPENAI_AMBIENT_HEADERS, openAIUsage } from "./openai.ts";
import { openRouterPlugins } from "./openrouter.ts";
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
 * OpenAI Chat Completions (OpenRouter, and KIE's and ToAPIs' Gemini models): documents replace the
 * marker part (`file` for PDFs, `image_url` for images), and the response schema becomes a strict
 * `response_format`. A Gemini model gets the schema as Gemini's own API takes it
 * (`sanitizeSchemaForGemini`): behind these routes Gemini still checks it, and ToAPIs failed the
 * article-scan schema (it has `minItems` and `maxItems`) with "生成失敗" on 2026-11-25. On
 * OpenRouter only, the file-parser plugin is pinned to `native`; KIE and ToAPIs get no `plugins`.
 * With a schema, OpenRouter is asked to route only to endpoints that honour it: the turn's model
 * carries `compat.openRouterRouting.require_parameters` (`prepareTurn`), which pi-ai sends as
 * `provider`.
 */
export function transformOpenAICompletionsPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload, ...openRouterPlugins(payload, plan) };
  if (plan.marker !== undefined) {
    const replacement = plan.documents.map((document) => encodeDocument(document, COMPLETIONS_PARTS));
    next.messages = replaceDocumentMarker(payload.messages, plan.marker, replacement, { partsKey: "content", textOf: textOfType("text") });
  }
  if (plan.responseSchema) {
    const { name, schema } = plan.responseSchema;
    next.response_format = {
      type: "json_schema",
      json_schema: { name, schema: isGeminiModel(payload.model) ? sanitizeSchemaForGemini(schema) : schema, strict: true },
    };
  }
  return next;
}

/** A Gemini model id on any host: `gemini-…`, or OpenRouter's `google/gemini-…`. */
function isGeminiModel(id: unknown): boolean {
  return typeof id === "string" && /(?:^|\/)gemini-/.test(id);
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
  suppressedHeaders: OPENAI_AMBIENT_HEADERS,
  schemaAsToolCall: () => false,
  placeDocument: placeByUrl,
  unsupported: () => undefined,
  transform: transformOpenAICompletionsPayload,
  createObserver: createOpenAICompletionsObserver,
};
