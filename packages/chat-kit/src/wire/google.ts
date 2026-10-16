import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { assertMarkerReplaced, renderTextDocument, spliceMarker, type PreparedDocument } from "../documents.ts";
import { isRecord } from "../guards.ts";
import type { ChatDocument, ChatUsage } from "../types.ts";
import { tokenCount, toChatUsage } from "../usage.ts";
import { sanitizeSchemaForGemini } from "./gemini-schema.ts";
import type { BlockedTurn, PayloadPlan, StreamObserver, WireApi } from "./types.ts";

/** Gemini fetches an external (HTTP or signed) URL only up to 15 MB per file. */
export const GEMINI_URL_MAX_BYTES = 15_000_000;

/** Candidate finish reasons that mean a safety filter cut the answer off. `RECITATION` is not one. */
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

type GooglePart = Record<string, unknown>;
interface GoogleContent {
  role?: string;
  parts?: GooglePart[];
}

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

function googlePart(document: PreparedDocument): GooglePart {
  if (document.kind === "text") return { text: renderTextDocument(document) };
  return document.source.type === "url"
    ? { fileData: { fileUri: document.source.url, mimeType: document.mimeType } }
    : { inlineData: { mimeType: document.mimeType, data: document.source.data } };
}

/**
 * Gemini (`GenerateContentParameters` from `@google/genai`): documents replace the marker part,
 * the response schema becomes `config.responseMimeType` + `config.responseJsonSchema`, and
 * grounding appends the Google Search and URL context tools. `config.abortSignal` is kept as is.
 */
export function transformGooglePayload(payload: unknown, plan: PayloadPlan): unknown {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (plan.marker !== undefined) {
    const marker = plan.marker;
    const replacement = plan.documents.map(googlePart);
    const counter = { found: 0 };
    const contents = Array.isArray(payload.contents) ? (payload.contents as GoogleContent[]) : [];
    next.contents = contents.map((content) =>
      Array.isArray(content.parts)
        ? {
            ...content,
            parts: spliceMarker(
              content.parts,
              marker,
              (part) => (typeof part.text === "string" ? part.text : undefined),
              replacement,
              counter,
            ),
          }
        : content,
    );
    assertMarkerReplaced(counter);
  }
  const config: Record<string, unknown> = isRecord(payload.config) ? { ...payload.config } : {};
  if (plan.responseSchema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = sanitizeSchemaForGemini(plan.responseSchema.schema);
  }
  if (plan.grounding) {
    config.tools = [...(Array.isArray(config.tools) ? config.tools : []), { googleSearch: {} }, { urlContext: {} }];
  }
  next.config = config;
  return next;
}

/**
 * Usage from the last chunk's `usageMetadata`. `promptTokenCount` already includes
 * `cachedContentTokenCount`, and the answer is `candidatesTokenCount` plus `thoughtsTokenCount`.
 * Gemini has no cache-write count. Its JSON leaves zero-valued counters out, so a missing answer
 * count (a blocked prompt) is a reported zero; a missing cache or thinking count is simply not
 * reported, and is omitted.
 */
function googleUsage(usageMetadata: Record<string, unknown>): ChatUsage | undefined {
  const candidates = tokenCount(usageMetadata.candidatesTokenCount);
  const thoughts = tokenCount(usageMetadata.thoughtsTokenCount);
  return toChatUsage(
    {
      input: tokenCount(usageMetadata.promptTokenCount),
      output: (candidates ?? 0) + (thoughts ?? 0),
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
  schemaAsToolCall: false,
  placeDocument: placeGoogleDocument,
  unsupported: () => undefined,
  transform: transformGooglePayload,
  createObserver: createGoogleObserver,
};
