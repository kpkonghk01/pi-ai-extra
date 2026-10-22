import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";
import type { ChatDocument, ChatUsage } from "../types.ts";
import { sumReported, tokenCount, toChatUsage } from "../usage.ts";
import { encodeDocument, replaceDocumentMarker, textOfUntypedPart, type DocumentEncoder } from "./document-parts.ts";
import { sanitizeSchemaForGemini } from "./gemini-schema.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

/** Gemini fetches an external (HTTP or signed) URL only up to 15 MB per file. */
export const GEMINI_URL_MAX_BYTES = 15_000_000;

/** Candidate finish reasons that mean a safety filter cut the answer off. `RECITATION` is not one. */
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

type GooglePart = Record<string, unknown>;

/**
 * Gemini takes a document by URL (`fileData`) only when the URL is set, its size is known to be
 * within Gemini's 15 MB external-URL limit, and the model is not Gemini 2.0 (which does not
 * fetch external URLs). Otherwise it is sent inline.
 */
export function placeGoogleDocument(document: ChatDocument, model: Model<Api>): "url" | "inline" {
  const fetchable =
    document.url !== undefined &&
    document.size !== undefined &&
    document.size <= GEMINI_URL_MAX_BYTES &&
    !model.id.startsWith("gemini-2.0");
  return fetchable ? "url" : "inline";
}

/** A PDF and an image are the same part: `fileData` by URL, `inlineData` with the bytes. */
const GOOGLE_PARTS: DocumentEncoder<GooglePart, GooglePart> = {
  text: (text) => ({ text }),
  url: (url, document) => ({ fileData: { fileUri: url, mimeType: document.mimeType } }),
  inline: (data, document) => ({ inlineData: { mimeType: document.mimeType, data } }),
  pdf: (part) => part,
  image: (part) => part,
};

/**
 * Gemini (`GenerateContentParameters` from `@google/genai`): documents replace the marker part,
 * and the response schema becomes `config.responseMimeType` + `config.responseJsonSchema`.
 * `config.abortSignal` is kept as is. Grounding is the Google provider's own (its `grounding`
 * option), added after this transform.
 */
export function transformGooglePayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (plan.marker !== undefined) {
    const replacement = plan.documents.map((document) => encodeDocument(document, GOOGLE_PARTS));
    next.contents = replaceDocumentMarker(payload.contents, plan.marker, replacement, { partsKey: "parts", textOf: textOfUntypedPart });
  }
  const config: Record<string, unknown> = isRecord(payload.config) ? { ...payload.config } : {};
  if (plan.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = sanitizeSchemaForGemini(plan.responseSchema.schema);
  }
  next.config = config;
  return next;
}

/**
 * Usage from the last chunk's `usageMetadata`. The prompt is `promptTokenCount`, which already
 * includes `cachedContentTokenCount` (so `input` is the prompt without it), plus
 * `toolUsePromptTokenCount`: the tool results grounding
 * feeds back to the model, billed as input. The answer is `candidatesTokenCount` plus
 * `thoughtsTokenCount`. Gemini's `totalTokenCount` is the sum of all four. Each side sums only the
 * counts Gemini reported and is omitted when it reported none of them, as in the Gemini image
 * client: Gemini's JSON leaves zero-valued counters out, so a blocked prompt's usage has no
 * `output`. Gemini has no cache-write count.
 */
function googleUsage(usageMetadata: Record<string, unknown>): ChatUsage | undefined {
  const thoughts = tokenCount(usageMetadata.thoughtsTokenCount);
  return toChatUsage(
    {
      prompt: sumReported(tokenCount(usageMetadata.promptTokenCount), tokenCount(usageMetadata.toolUsePromptTokenCount)),
      output: sumReported(tokenCount(usageMetadata.candidatesTokenCount), thoughts),
      total: tokenCount(usageMetadata.totalTokenCount),
      cacheRead: tokenCount(usageMetadata.cachedContentTokenCount),
      reasoning: thoughts,
    },
    { usageMetadata },
  );
}

/**
 * Gemini reports a blocked prompt only as `promptFeedback.blockReason` on a chunk without
 * candidates, which pi-ai surfaces as "Google stream ended without a finish reason"; the raw
 * chunk is the only place it shows. Usage comes from `usageMetadata` (Gemini bills blocked prompts).
 */
export function createGoogleObserver(): StreamObserver {
  let usageMetadata: Record<string, unknown> | undefined;
  let promptBlockReason: string | undefined;
  return {
    observe(chunk) {
      if (!isRecord(chunk)) return;
      if (isRecord(chunk.usageMetadata)) usageMetadata = chunk.usageMetadata;
      const feedback = chunk.promptFeedback;
      if (isRecord(feedback) && typeof feedback.blockReason === "string" && feedback.blockReason) {
        promptBlockReason = feedback.blockReason;
      }
    },
    usage: () => (usageMetadata === undefined ? undefined : googleUsage(usageMetadata)),
    blocked(message: AssistantMessage): BlockedTurn | undefined {
      if (promptBlockReason !== undefined) {
        return { reason: promptBlockReason, message: `Gemini blocked the prompt (${promptBlockReason}).` };
      }
      const reason = message.rawStopReason;
      if (reason !== undefined && BLOCKED_FINISH_REASONS.has(reason)) {
        return { reason, message: `Gemini's safety filter stopped the answer (${reason}).` };
      }
      return undefined;
    },
  };
}

export const GOOGLE_WIRE_API: WireApi = {
  api: "google-generative-ai",
  acceptsFetch: false,
  schemaAsToolCall: () => false,
  placeDocument: placeGoogleDocument,
  unsupported: () => undefined,
  transform: transformGooglePayload,
  createObserver: createGoogleObserver,
};
