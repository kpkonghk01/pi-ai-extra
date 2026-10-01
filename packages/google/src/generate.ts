import { z } from "zod";
import {
  assertApiKey,
  assertSupportedModel,
  completeResult,
  contextError,
  createOperationContext,
  DEFAULT_MAX_OUTPUT_BYTES,
  DOWNLOAD_RETRY,
  downloadImage,
  emitProgress,
  encodeBase64,
  httpUrlSchema,
  parseRequest,
  resolveReferenceImages,
  splitHelperOptions,
  throwIfAborted,
  withoutTrailingSlash,
  type ImageGenerationResult,
  type ImageHelperOptions,
  type OperationContext,
  type ReferenceImageSpec,
  type ResolvedReference,
} from "@hk01/pi-ai-extra-internal";
import { generateContentImages, type InlineImagePart } from "./client.ts";
import { GOOGLE_BASE_URL, GOOGLE_PROVIDER_ID } from "./constants.ts";
import {
  GOOGLE_IMAGE_MODEL_IDS,
  googleModelDefinition,
  type GoogleFlashImageAspectRatio,
  type GoogleFlashImageSize,
  type GoogleImageModelId,
  type GoogleProImageAspectRatio,
  type GoogleProImageSize,
  type GoogleSafetySetting,
} from "./models.ts";

/** Advanced transport settings. */
export interface GoogleImageSettings {
  /** Default `https://generativelanguage.googleapis.com/v1beta`. */
  baseUrl?: string | undefined;
  /**
   * Extra non-credential request headers (for example `{ "User-Agent": "aistudio-build" }`
   * in Google AI Studio apps). The API key is always sent from `apiKey`.
   */
  headers?: Record<string, string> | undefined;
}

interface GoogleRequestBase extends ImageHelperOptions, GoogleImageSettings {
  prompt: string;
  /** Data URLs, or http(s) URLs that the server downloads and sends inline. Up to 14. */
  referenceImages?: readonly string[] | undefined;
  safetySettings?: readonly GoogleSafetySetting[] | undefined;
  /** Gemini `generationConfig.temperature`. Omitted: the model's default. */
  temperature?: number | undefined;
  /** Gemini `systemInstruction` (text only). Omitted: none. */
  systemInstruction?: string | undefined;
}

export interface GoogleFlashImageRequest extends GoogleRequestBase {
  model: "gemini-3.1-flash-image";
  aspectRatio?: GoogleFlashImageAspectRatio | undefined;
  /** Gemini `imageSize`. Default 1K. */
  resolution?: GoogleFlashImageSize | undefined;
}

export interface GoogleProImageRequest extends GoogleRequestBase {
  model: "gemini-3-pro-image";
  aspectRatio?: GoogleProImageAspectRatio | undefined;
  /** Gemini `imageSize`. Default 1K. */
  resolution?: GoogleProImageSize | undefined;
}

export type GoogleImageRequest = GoogleFlashImageRequest | GoogleProImageRequest;

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const REFERENCE_DOWNLOAD_TIMEOUT_MS = 30_000;
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "cookie"]);

const settingsSchema = z.strictObject({
  baseUrl: httpUrlSchema.optional(),
  headers: z
    .record(z.string(), z.string())
    .refine((headers) => Object.keys(headers).every((name) => !CREDENTIAL_HEADERS.has(name.toLowerCase())), {
      message: "headers must not carry credentials; pass the key as apiKey",
    })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
});

/**
 * Generates or edits an image with a Gemini image model through `generateContent`.
 * Reference images are sent inline; http(s) references are downloaded first (never
 * re-hosted elsewhere). Safety blocks and empty results are reported as errors.
 */
export async function generateGoogleImage(request: GoogleImageRequest): Promise<ImageGenerationResult> {
  const ctx = createOperationContext({
    provider: GOOGLE_PROVIDER_ID,
    model: String(request.model),
    signal: request.signal,
    fetch: request.fetch,
    onProgress: request.onProgress,
  });
  assertSupportedModel(ctx, request.model, GOOGLE_IMAGE_MODEL_IDS);
  assertApiKey(ctx, request.apiKey);

  const { settings, payload } = splitHelperOptions(request);
  const { baseUrl, headers, ...modelPayload } = payload;
  const options = parseRequest(ctx, settingsSchema, {
    baseUrl,
    headers,
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
  });
  const definition = googleModelDefinition(request.model as GoogleImageModelId);
  const parsed = parseRequest(ctx, definition.schema, modelPayload);
  const references = resolveReferenceImages(ctx, parsed.referenceImages, definition.info.referenceImages);
  emitProgress(ctx, { type: "validated", referenceImageCount: references.length });

  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const images = await inlineReferences(ctx, references, definition.info.referenceImages);

  throwIfAborted(ctx, "generate");
  emitProgress(ctx, { type: "request_sent" });
  const generated = await generateContentImages(ctx, {
    baseUrl: withoutTrailingSlash(options.baseUrl ?? GOOGLE_BASE_URL),
    apiKey: request.apiKey,
    model: parsed.model,
    prompt: parsed.prompt,
    images,
    aspectRatio: parsed.aspectRatio,
    imageSize: parsed.resolution,
    safetySettings: parsed.safetySettings,
    temperature: parsed.temperature,
    systemInstruction: parsed.systemInstruction,
    headers: options.headers ?? {},
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes,
  });
  return completeResult(ctx, generated.responseId, generated.images, generated.usage);
}

/** Inline data stays as-is; URL references are fetched with the same type/size rules as inline ones. */
async function inlineReferences(
  ctx: OperationContext,
  references: readonly ResolvedReference[],
  spec: ReferenceImageSpec,
): Promise<InlineImagePart[]> {
  const parts: InlineImagePart[] = [];
  for (const reference of references) {
    if (reference.kind === "inline") {
      parts.push({ mimeType: reference.mimeType, base64: reference.base64 });
      continue;
    }
    emitProgress(ctx, { type: "download_started", index: reference.index, total: references.length, url: reference.url });
    const image = await downloadImage(ctx, reference.url, {
      timeoutMs: REFERENCE_DOWNLOAD_TIMEOUT_MS,
      maxBytes: spec.maxInlineBytes,
      retry: DOWNLOAD_RETRY,
    });
    if (!spec.acceptedMimeTypes.includes(image.mimeType)) {
      throw contextError(ctx, `referenceImages[${reference.index}] is ${image.mimeType}; accepted types: ${spec.acceptedMimeTypes.join(", ")}.`, {
        code: "invalid_reference",
        operation: "download",
      });
    }
    parts.push({ mimeType: image.mimeType, base64: encodeBase64(image.bytes) });
  }
  return parts;
}
