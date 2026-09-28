import { z } from "zod";
import {
  contextError,
  decodeBase64,
  formatBytes,
  requestJson,
  safeStringify,
  sniffImageMimeType,
  truncate,
  type ImageBytes,
  type OperationContext,
} from "@hk01/pi-ai-extra-internal";
import type { GoogleSafetySetting } from "./models.ts";

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
  safetySettings: readonly GoogleSafetySetting[] | undefined;
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

/**
 * Calls `models/{model}:generateContent` once. Not retried automatically: generation is billed.
 * Returns the final (non-thought) inline images, validated by magic bytes and size.
 */
export async function generateContentImages(
  ctx: OperationContext,
  input: GenerateContentInput,
): Promise<{ images: ImageBytes[]; responseId: string | undefined }> {
  const imageConfig: Record<string, string> = {};
  if (input.aspectRatio) imageConfig.aspectRatio = input.aspectRatio;
  if (input.imageSize) imageConfig.imageSize = input.imageSize;
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }, ...input.images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64 } }))],
      },
    ],
    generationConfig: Object.keys(imageConfig).length > 0 ? { imageConfig } : {},
  };
  if (input.safetySettings && input.safetySettings.length > 0) body.safetySettings = input.safetySettings;

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
  );
  return { images: extractImages(ctx, response, input.maxOutputBytes), responseId: response.responseId };
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

function suffix(message: string | undefined): string {
  return message?.trim() ? `: ${message.trim()}` : "";
}
