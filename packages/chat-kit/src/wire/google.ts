import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";
import type { ChatDocument, ChatUsage } from "../types.ts";
import { overlayReported, remainderReported, sumReported, tokenCount, toChatUsage } from "../usage.ts";
import { encodeDocument, replaceDocumentMarker, textOfUntypedPart, type DocumentEncoder } from "./document-parts.ts";
import { sanitizeSchemaForGemini } from "./gemini-schema.ts";
import type { BlockedTurn, ClassifiedFailure, PayloadPlan, ProviderFailure, StreamObserver, WireApi } from "./types.ts";

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
 * Usage from the stream's `usageMetadata`. The prompt is `promptTokenCount`, which already
 * includes `cachedContentTokenCount` (so `input` is the prompt without it), plus
 * `toolUsePromptTokenCount`: the tool results grounding
 * feeds back to the model, billed as input. The answer is `candidatesTokenCount` plus
 * `thoughtsTokenCount`. Gemini's `totalTokenCount` is the sum of all four, so a `promptTokenCount`
 * the stream left out is the total minus the other three, unless they add up to more: on AI Studio,
 * the usage of a turn with a document by URL had no `promptTokenCount`. Each side sums only the
 * counts Gemini reported and is omitted when it reported none of them, as in the Gemini image
 * client: Gemini's JSON leaves zero-valued counters out, so a blocked prompt's usage has no
 * `output`. Gemini has no cache-write count.
 */
function googleUsage(usageMetadata: Record<string, unknown>): ChatUsage | undefined {
  const thoughts = tokenCount(usageMetadata.thoughtsTokenCount);
  const candidates = tokenCount(usageMetadata.candidatesTokenCount);
  const toolUsePrompt = tokenCount(usageMetadata.toolUsePromptTokenCount);
  const total = tokenCount(usageMetadata.totalTokenCount);
  const prompt = tokenCount(usageMetadata.promptTokenCount) ?? remainderReported(total, candidates, thoughts, toolUsePrompt);
  return toChatUsage(
    {
      prompt: sumReported(prompt, toolUsePrompt),
      output: sumReported(candidates, thoughts),
      total,
      cacheRead: tokenCount(usageMetadata.cachedContentTokenCount),
      reasoning: thoughts,
    },
    { usageMetadata },
  );
}

/**
 * Gemini reports a blocked prompt only as `promptFeedback.blockReason` on a chunk without
 * candidates, which pi-ai surfaces as "Google stream ended without a finish reason"; the raw
 * chunk is the only place it shows. Usage comes from `usageMetadata` (Gemini bills blocked prompts),
 * each field at the last value a chunk reported, so a count only an earlier chunk carried is kept.
 * Whether AI Studio sends the prompt count in an earlier chunk of a turn whose last chunk leaves
 * it out has not been seen.
 */
export function createGoogleObserver(): StreamObserver {
  let usageMetadata: Record<string, unknown> | undefined;
  let promptBlockReason: string | undefined;
  return {
    observe(chunk) {
      if (!isRecord(chunk)) return;
      if (isRecord(chunk.usageMetadata)) usageMetadata = overlayReported(usageMetadata, chunk.usageMetadata);
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

/**
 * Google answers a document URL it could not fetch with a 400 whose message says so. Seen on Agent
 * Platform on 2026-11-02, for an S3 presigned link whose fetch timed out (status URL rejected,
 * fetch timeout) and for a link whose host does not resolve. Not yet seen on AI Studio, whose
 * `fileData` fetch is taken to fail the same way, so both Google APIs read it.
 */
const UNFETCHABLE_URL = /Cannot fetch content from the provided URL/i;

/**
 * Google's 400 for a document URL it could not fetch is `DOCUMENT_FETCH_FAILED`, when the turn sent
 * a document by URL; any other failure stays as it is.
 */
function classifyGoogleFailure(failure: ProviderFailure, plan: PayloadPlan): ClassifiedFailure | undefined {
  const byUrl = plan.documents.some((document) => document.kind !== "text" && document.source.type === "url");
  if (!byUrl || failure.status !== 400 || !UNFETCHABLE_URL.test(failure.errorMessage)) return undefined;
  return { code: "DOCUMENT_FETCH_FAILED", account: "The provider could not fetch a document from its URL" };
}

/** Gemini on Google AI Studio: pi-ai's Gemini adapter, which rejects a custom fetch. */
export const GOOGLE_WIRE_API: WireApi = {
  api: "google-generative-ai",
  acceptsFetch: false,
  schemaAsToolCall: () => false,
  placeDocument: placeGoogleDocument,
  unsupported: () => undefined,
  transform: transformGooglePayload,
  createObserver: createGoogleObserver,
  classifyFailure: classifyGoogleFailure,
};

/**
 * Gemini on Google Agent Platform: pi-ai's Vertex adapter builds the same `@google/genai` request
 * and reads the same stream as its Gemini adapter, and rejects a custom fetch too, so the kit
 * handles it the same way.
 */
export const GOOGLE_VERTEX_WIRE_API: WireApi = { ...GOOGLE_WIRE_API, api: "google-vertex" };
