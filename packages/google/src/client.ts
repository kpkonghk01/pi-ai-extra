import { z } from "zod";
import {
  compactUsage,
  contextError,
  decodeBase64,
  formatBytes,
  isPiAiExtraError,
  omitUndefined,
  requestJson,
  safeStringify,
  sniffImageMimeType,
  parseUsageBlock,
  tokenCountSchema,
  truncate,
  withErrorContext,
  type ImageBytes,
  type ImageUsage,
  type OperationContext,
} from "@hk01/pi-ai-extra-internal";
import type { GoogleImageConfigFormat, GoogleSafetySetting } from "./models.ts";

export interface InlineImagePart {
  mimeType: string;
  base64: string;
}

export interface GenerateContentInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  images: readonly InlineImagePart[];
  aspectRatio: string | undefined;
  imageSize: string | undefined;
  imageConfigFormat: GoogleImageConfigFormat;
  safetySettings: readonly GoogleSafetySetting[] | undefined;
  temperature: number | undefined;
  systemInstruction: string | undefined;
  headers: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
        finishMessage: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional(), blockReasonMessage: z.string().optional() }).optional(),
  responseId: z.string().optional(),
  // Validated separately (see googleUsage) so an accounting shape change cannot fail a finished image.
  usageMetadata: z.unknown().optional(),
});

const modalityCounts = z.array(z.object({ modality: z.string(), tokenCount: tokenCountSchema.optional() })).optional();

/** Gemini API `UsageMetadata` (generate-content reference). */
const usageMetadataSchema = z.object({
  promptTokenCount: tokenCountSchema.optional(),
  cachedContentTokenCount: tokenCountSchema.optional(),
  candidatesTokenCount: tokenCountSchema.optional(),
  toolUsePromptTokenCount: tokenCountSchema.optional(),
  thoughtsTokenCount: tokenCountSchema.optional(),
  totalTokenCount: tokenCountSchema.optional(),
  promptTokensDetails: modalityCounts,
  cacheTokensDetails: modalityCounts,
  candidatesTokensDetails: modalityCounts,
});

type GenerateContentResponse = z.infer<typeof responseSchema>;

/** Finish reasons that mean Gemini refused on safety or policy grounds. */
const BLOCKING_FINISH_REASONS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
  "IMAGE_RECITATION",
]);

const RESPONSE_FORMAT_ASPECT_RATIOS: Record<string, string> = {
  "1:1": "ASPECT_RATIO_ONE_BY_ONE",
  "2:3": "ASPECT_RATIO_TWO_BY_THREE",
  "3:2": "ASPECT_RATIO_THREE_BY_TWO",
  "3:4": "ASPECT_RATIO_THREE_BY_FOUR",
  "4:3": "ASPECT_RATIO_FOUR_BY_THREE",
  "4:5": "ASPECT_RATIO_FOUR_BY_FIVE",
  "5:4": "ASPECT_RATIO_FIVE_BY_FOUR",
  "9:16": "ASPECT_RATIO_NINE_BY_SIXTEEN",
  "16:9": "ASPECT_RATIO_SIXTEEN_BY_NINE",
  "21:9": "ASPECT_RATIO_TWENTY_ONE_BY_NINE",
  "1:8": "ASPECT_RATIO_ONE_BY_EIGHT",
  "8:1": "ASPECT_RATIO_EIGHT_BY_ONE",
  "1:4": "ASPECT_RATIO_ONE_BY_FOUR",
  "4:1": "ASPECT_RATIO_FOUR_BY_ONE",
};

const RESPONSE_FORMAT_IMAGE_SIZES: Record<string, string> = {
  "512": "IMAGE_SIZE_FIVE_TWELVE",
  "1K": "IMAGE_SIZE_ONE_K",
  "2K": "IMAGE_SIZE_TWO_K",
  "4K": "IMAGE_SIZE_FOUR_K",
};

/**
 * Calls `models/{model}:generateContent` once. Not retried automatically: generation is billed.
 * Returns the final (non-thought) inline images, validated by magic bytes and size.
 */
export async function generateContentImages(
  ctx: OperationContext,
  input: GenerateContentInput,
): Promise<{ images: ImageBytes[]; responseId: string | undefined; usage: ImageUsage | undefined }> {
  const imageSettings = omitUndefined({ aspectRatio: input.aspectRatio, imageSize: input.imageSize });
  const responseFormatImage = omitUndefined({
    aspectRatio: input.aspectRatio === undefined ? undefined : RESPONSE_FORMAT_ASPECT_RATIOS[input.aspectRatio],
    imageSize: input.imageSize === undefined ? undefined : RESPONSE_FORMAT_IMAGE_SIZES[input.imageSize],
  });
  const generationConfig =
    input.imageConfigFormat === "responseFormat"
      ? omitUndefined({
          temperature: input.temperature,
          responseModalities: ["TEXT", "IMAGE"],
          responseFormat: Object.keys(responseFormatImage).length > 0 ? { image: responseFormatImage } : undefined,
        })
      : omitUndefined({
          temperature: input.temperature,
          imageConfig: Object.keys(imageSettings).length > 0 ? imageSettings : undefined,
        });
  const body = omitUndefined({
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }, ...input.images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } }))],
      },
    ],
    systemInstruction: input.systemInstruction === undefined ? undefined : { parts: [{ text: input.systemInstruction }] },
    generationConfig,
    safetySettings: input.safetySettings && input.safetySettings.length > 0 ? input.safetySettings : undefined,
  });

  const response = await requestJson(
    ctx,
    {
      url: `${input.baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`,
      method: "POST",
      headers: { ...input.headers, "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      operation: "generate",
      timeoutMs: input.timeoutMs,
    },
    responseSchema,
  ).catch((error: unknown) => {
    throw asAuthErrorIfInvalidKey(error);
  });
  const images = extractImages(ctx, response, input.maxOutputBytes);
  return { images, responseId: response.responseId, usage: googleUsage(ctx, response.usageMetadata) };
}

/**
 * Token counts from `usageMetadata`. The JSON API omits zero-valued counters; omitted
 * counters stay omitted here rather than being reported as 0.
 */
function googleUsage(ctx: OperationContext, value: unknown): ImageUsage | undefined {
  const metadata = parseUsageBlock(ctx, usageMetadataSchema, value, "Gemini usageMetadata");
  if (!metadata) return undefined;
  const byModality = (details: z.infer<typeof modalityCounts>, modality: string): number | undefined =>
    details?.find((detail) => detail.modality === modality)?.tokenCount;
  return compactUsage({
    tokens: {
      input: metadata.promptTokenCount,
      output: metadata.candidatesTokenCount,
      total: metadata.totalTokenCount,
      inputText: byModality(metadata.promptTokensDetails, "TEXT"),
      inputImage: byModality(metadata.promptTokensDetails, "IMAGE"),
      cachedInput: metadata.cachedContentTokenCount,
      cachedInputText: byModality(metadata.cacheTokensDetails, "TEXT"),
      cachedInputImage: byModality(metadata.cacheTokensDetails, "IMAGE"),
      outputText: byModality(metadata.candidatesTokensDetails, "TEXT"),
      outputImage: byModality(metadata.candidatesTokensDetails, "IMAGE"),
      reasoning: metadata.thoughtsTokenCount,
      toolUsePrompt: metadata.toolUsePromptTokenCount,
    },
  });
}

function extractImages(ctx: OperationContext, response: GenerateContentResponse, maxOutputBytes: number): ImageBytes[] {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const images = parts.flatMap((part) => (part.inlineData && part.thought !== true ? [part.inlineData] : []));
  if (images.length > 0) return images.map((image) => decodeOutput(ctx, image.data, maxOutputBytes));

  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw contextError(ctx, `Prompt blocked by Gemini (${blockReason})${suffix(response.promptFeedback?.blockReasonMessage)}.`, {
      code: "content_blocked",
      operation: "generate",
      providerCode: blockReason,
      responseBody: truncate(safeStringify(response)),
    });
  }
  const finishReason = candidate?.finishReason;
  const text = parts
    .flatMap((part) => (part.text && part.thought !== true ? [part.text] : []))
    .join(" ")
    .trim();
  const blocked = finishReason !== undefined && BLOCKING_FINISH_REASONS.has(finishReason);
  throw contextError(
    ctx,
    `Gemini returned no image (finishReason ${finishReason ?? "unknown"})${suffix(candidate?.finishMessage)}${text ? `; model text: ${truncate(text, 300)}` : ""}.`,
    {
      code: blocked ? "content_blocked" : "no_output",
      operation: "generate",
      providerCode: finishReason,
      responseBody: truncate(safeStringify(response)),
    },
  );
}

function decodeOutput(ctx: OperationContext, base64: string, maxOutputBytes: number): ImageBytes {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength > maxOutputBytes) {
    throw contextError(ctx, `Generated image is ${formatBytes(bytes.byteLength)}, above the ${formatBytes(maxOutputBytes)} limit.`, {
      code: "invalid_output",
      operation: "generate",
    });
  }
  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) {
    throw contextError(ctx, "Gemini returned inline data that is not a PNG, JPEG, WebP or GIF image.", {
      code: "invalid_output",
      operation: "generate",
    });
  }
  return { mimeType, bytes };
}

/** Gemini reports a bad API key as HTTP 400 INVALID_ARGUMENT with reason API_KEY_INVALID. */
function asAuthErrorIfInvalidKey(error: unknown): unknown {
  if (isPiAiExtraError(error) && error.status === 400 && /API_KEY_INVALID|API key not valid/.test(error.responseBody ?? error.message)) {
    return withErrorContext(error, { code: "auth" });
  }
  return error;
}

function suffix(message: string | undefined): string {
  return message?.trim() ? `: ${message.trim()}` : "";
}
