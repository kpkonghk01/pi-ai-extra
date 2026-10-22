import type { AssistantMessage } from "@earendil-works/pi-ai";
import { dataUrl } from "../documents.ts";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";
import { createUsageCapture } from "../usage.ts";
import { encodeDocument, placeByUrl, replaceDocumentMarker, textOfType, type DocumentEncoder } from "./document-parts.ts";
import { CONTENT_FILTER_BLOCK, openAIUsage, RESPONSES_USAGE_FIELDS } from "./openai.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

type ResponsesPart = Record<string, unknown>;

/** A file reference: a URL the provider fetches, or the bytes inline as a data URL. */
type ResponsesFile = { url: string } | { dataUrl: string };

const RESPONSES_PARTS: DocumentEncoder<ResponsesPart, ResponsesFile> = {
  text: (text) => ({ type: "input_text", text }),
  url: (url) => ({ url }),
  inline: (data, document) => ({ dataUrl: dataUrl(document.mimeType, data) }),
  // An `input_file` takes a URL as `file_url` and a data URL as `file_data`.
  pdf: (file, document) => ({
    type: "input_file",
    filename: document.name,
    ...("url" in file ? { file_url: file.url } : { file_data: file.dataUrl }),
  }),
  // An `input_image` takes either as `image_url`.
  image: (file) => ({ type: "input_image", detail: "auto", image_url: "url" in file ? file.url : file.dataUrl }),
};

/**
 * OpenAI Responses (KIE and ToAPIs Codex): documents replace the marker part (`input_file` for
 * PDFs, `input_image` for images) and the response schema becomes a strict `text.format`, keeping
 * any other `text` options pi-ai set (such as `verbosity`).
 */
export function transformOpenAIResponsesPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (plan.marker !== undefined) {
    const replacement = plan.documents.map((document) => encodeDocument(document, RESPONSES_PARTS));
    next.input = replaceDocumentMarker(payload.input, plan.marker, replacement, { partsKey: "content", textOf: textOfType("input_text") });
  }
  if (plan.responseSchema) {
    next.text = {
      ...(isRecord(payload.text) ? payload.text : {}),
      format: { type: "json_schema", name: plan.responseSchema.name, schema: plan.responseSchema.schema, strict: true },
    };
  }
  return next;
}

/**
 * A content filter shows as an `incomplete` response with reason `content_filter`; a refusal
 * streams as `response.refusal.delta` on a response that otherwise completes. Usage is on the
 * terminal response.
 *
 * KIE also reports `credits_consumed`, outside OpenAI's shape: its docs put it on the
 * `response.completed` event next to `type` when streaming, and on the response object without
 * streaming (https://docs.kie.ai/market/kimi/kimi-k3.md; the Codex pages show only the second).
 * So every cost or credit field is read from the event, its `response`, and the `usage` object of
 * either, and kept at the top of raw usage, even without a usage object.
 */
export function createOpenAIResponsesObserver(): StreamObserver {
  const capture = createUsageCapture();
  let refused = false;
  return {
    observe(event) {
      if (!isRecord(event)) return;
      if (event.type === "response.refusal.delta") refused = true;
      const response = isRecord(event.response) ? event.response : undefined;
      if (response !== undefined && isRecord(response.usage)) capture.replace(response.usage);
      for (const container of [response?.usage, event.usage, response, event]) {
        if (isRecord(container)) capture.addBilling(container);
      }
    },
    usage: () => capture.read((usage, raw) => openAIUsage(usage, raw, RESPONSES_USAGE_FIELDS)),
    blocked(message: AssistantMessage): BlockedTurn | undefined {
      if (message.rawStopReason === "incomplete.content_filter") return CONTENT_FILTER_BLOCK;
      if (refused) return { reason: "refusal", message: "The model refused to answer (refusal)." };
      return undefined;
    },
  };
}

export const OPENAI_RESPONSES_WIRE_API: WireApi = {
  api: "openai-responses",
  acceptsFetch: true,
  schemaAsToolCall: () => false,
  placeDocument: placeByUrl,
  unsupported: () => undefined,
  transform: transformOpenAIResponsesPayload,
  createObserver: createOpenAIResponsesObserver,
};
