import type { AssistantMessage } from "@earendil-works/pi-ai";
import { assertMarkerReplaced, dataUrl, renderTextDocument, spliceMarker, type PreparedDocument } from "../documents.ts";
import { isRecord } from "../guards.ts";
import type { ChatUsage } from "../types.ts";
import { billingFields, tokenCount, toChatUsage } from "../usage.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

type ResponsesPart = Record<string, unknown>;

function responsesPart(document: PreparedDocument): ResponsesPart {
  if (document.kind === "text") return { type: "input_text", text: renderTextDocument(document) };
  if (document.kind === "pdf") {
    return document.source.type === "url"
      ? { type: "input_file", filename: document.name, file_url: document.source.url }
      : { type: "input_file", filename: document.name, file_data: dataUrl(document.mimeType, document.source.data) };
  }
  const url = document.source.type === "url" ? document.source.url : dataUrl(document.mimeType, document.source.data);
  return { type: "input_image", detail: "auto", image_url: url };
}

/**
 * OpenAI Responses (KIE and ToAPIs Codex): documents replace the marker part (`input_file` for
 * PDFs, `input_image` for images) and the response schema becomes a strict `text.format`, keeping
 * any other `text` options pi-ai set (such as `verbosity`).
 */
export function transformOpenAIResponsesPayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (plan.marker !== undefined) {
    const marker = plan.marker;
    const replacement = plan.documents.map(responsesPart);
    const counter = { found: 0 };
    const input = Array.isArray(payload.input) ? (payload.input as Record<string, unknown>[]) : [];
    next.input = input.map((item) =>
      item.role === "user" && Array.isArray(item.content)
        ? {
            ...item,
            content: spliceMarker(
              item.content as ResponsesPart[],
              marker,
              (part) => (part.type === "input_text" && typeof part.text === "string" ? part.text : undefined),
              replacement,
              counter,
            ),
          }
        : item,
    );
    assertMarkerReplaced(counter);
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
 * The Responses usage object: `input_tokens` already includes cache reads
 * (`input_tokens_details.cached_tokens`) and, where a provider reports them, cache writes
 * (`input_tokens_details.cache_write_tokens`); `output_tokens` includes
 * `output_tokens_details.reasoning_tokens`.
 */
function responsesUsage(usage: Record<string, unknown>, raw: Record<string, unknown>): ChatUsage | undefined {
  const input = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const output = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return toChatUsage(
    {
      input: tokenCount(usage.input_tokens),
      output: tokenCount(usage.output_tokens),
      total: tokenCount(usage.total_tokens),
      cacheRead: tokenCount(input.cached_tokens),
      cacheWrite: tokenCount(input.cache_write_tokens),
      reasoning: tokenCount(output.reasoning_tokens),
    },
    raw,
  );
}

/**
 * A content filter shows as an `incomplete` response with reason `content_filter`; a refusal
 * streams as `response.refusal.delta` on a response that otherwise completes. Usage is on the
 * terminal response, where KIE also reports `credits_consumed`.
 */
export function createOpenAIResponsesObserver(): StreamObserver {
  let usage: Record<string, unknown> | undefined;
  let raw: Record<string, unknown> = {};
  let refused = false;
  return {
    observe(event) {
      if (!isRecord(event)) return;
      if (event.type === "response.refusal.delta") refused = true;
      const response = event.response;
      if (isRecord(response) && isRecord(response.usage)) {
        usage = response.usage;
        raw = { usage, ...billingFields(response) };
      }
    },
    usage: () => (usage === undefined ? undefined : responsesUsage(usage, raw)),
    blocked(message: AssistantMessage): BlockedTurn | undefined {
      if (message.rawStopReason === "incomplete.content_filter") {
        return { reason: "content_filter", message: "The provider's content filter stopped the answer (content_filter)." };
      }
      if (refused) return { reason: "refusal", message: "The model refused to answer (refusal)." };
      return undefined;
    },
  };
}

export const OPENAI_RESPONSES_WIRE_API: WireApi = {
  api: "openai-responses",
  acceptsFetch: true,
  schemaAsToolCall: false,
  placeDocument: (document) => (document.url === undefined ? "inline" : "url"),
  unsupported: () => undefined,
  transform: transformOpenAIResponsesPayload,
  createObserver: createOpenAIResponsesObserver,
};
