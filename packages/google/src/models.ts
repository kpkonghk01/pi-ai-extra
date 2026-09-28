import { z } from "zod";
import { option, promptSchema, referenceImagesSchema, type ImageModelInfo, type ReferenceImageSpec } from "@hk01/pi-ai-extra-internal";
import { GOOGLE_PROVIDER_ID } from "./constants.ts";

export type GoogleImageModelId = "gemini-3.1-flash-image" | "gemini-3-pro-image";

export type GoogleProImageAspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
export type GoogleFlashImageAspectRatio = GoogleProImageAspectRatio | "1:4" | "4:1" | "1:8" | "8:1";
export type GoogleProImageSize = "1K" | "2K" | "4K";
export type GoogleFlashImageSize = "512" | GoogleProImageSize;

export type GoogleHarmCategory =
  | "HARM_CATEGORY_HARASSMENT"
  | "HARM_CATEGORY_HATE_SPEECH"
  | "HARM_CATEGORY_SEXUALLY_EXPLICIT"
  | "HARM_CATEGORY_DANGEROUS_CONTENT"
  | "HARM_CATEGORY_CIVIC_INTEGRITY";
export type GoogleHarmBlockThreshold = "BLOCK_LOW_AND_ABOVE" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_ONLY_HIGH" | "BLOCK_NONE" | "OFF";

export interface GoogleSafetySetting {
  category: GoogleHarmCategory;
  threshold: GoogleHarmBlockThreshold;
}

export interface NormalizedGoogleRequest {
  model: GoogleImageModelId;
  prompt: string;
  referenceImages: string[];
  aspectRatio?: string | undefined;
  resolution?: string | undefined;
  safetySettings?: GoogleSafetySetting[] | undefined;
}

interface GoogleModelDefinition {
  info: ImageModelInfo;
  schema: z.ZodType<NormalizedGoogleRequest>;
}

const PRO_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
const FLASH_RATIOS = [...PRO_RATIOS, "1:4", "4:1", "1:8", "8:1"] as const;
const PRO_SIZES = ["1K", "2K", "4K"] as const;
const FLASH_SIZES = ["512", ...PRO_SIZES] as const;
const HARM_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
] as const;
const THRESHOLDS = ["BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"] as const;

/** Gemini inline request data is limited to about 20 MB. */
const INLINE_LIMIT_BYTES = 20 * 1024 * 1024;
const REFERENCES: ReferenceImageSpec = {
  min: 0,
  max: 14,
  acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  maxInlineBytes: INLINE_LIMIT_BYTES,
};

const safetySettingsSchema = z
  .array(z.strictObject({ category: z.enum(HARM_CATEGORIES), threshold: z.enum(THRESHOLDS) }))
  .optional();

const COMMON_NOTES = [
  "Without aspectRatio the model matches the input image, or generates 1:1.",
  "http(s) reference URLs are downloaded by the server and sent inline.",
] as const;

function definition(
  id: GoogleImageModelId,
  name: string,
  ratios: readonly [string, ...string[]],
  sizes: readonly [string, ...string[]],
  notes: readonly string[],
): GoogleModelDefinition {
  return {
    info: {
      id,
      name,
      provider: GOOGLE_PROVIDER_ID,
      kind: "text-and-image-to-image",
      promptMaxLength: null,
      referenceImages: REFERENCES,
      aspectRatio: option(ratios, null),
      resolution: option(sizes, "1K"),
      background: null,
      outputFormat: null,
      watermark: false,
      notes: [...COMMON_NOTES, ...notes],
    },
    schema: z.strictObject({
      model: z.literal(id),
      prompt: promptSchema(null),
      referenceImages: referenceImagesSchema(id, REFERENCES),
      aspectRatio: z.enum(ratios).optional(),
      resolution: z.enum(sizes).optional(),
      safetySettings: safetySettingsSchema,
    }),
  };
}

const DEFINITIONS: Record<GoogleImageModelId, GoogleModelDefinition> = {
  "gemini-3.1-flash-image": definition("gemini-3.1-flash-image", "Gemini 3.1 Flash Image (Nano Banana 2)", FLASH_RATIOS, FLASH_SIZES, [
    "Up to 10 object and 4 character reference images.",
  ]),
  "gemini-3-pro-image": definition("gemini-3-pro-image", "Gemini 3 Pro Image (Nano Banana Pro)", PRO_RATIOS, PRO_SIZES, [
    "Up to 6 object, 5 character and 3 style reference images.",
  ]),
};

export const GOOGLE_IMAGE_MODEL_IDS: readonly GoogleImageModelId[] = Object.keys(DEFINITIONS) as GoogleImageModelId[];

/** Catalogue of supported Gemini image models and their documented constraints. */
export const GOOGLE_IMAGE_MODELS: readonly ImageModelInfo[] = GOOGLE_IMAGE_MODEL_IDS.map((id) => DEFINITIONS[id].info);

export function googleModelDefinition(id: GoogleImageModelId): GoogleModelDefinition {
  return DEFINITIONS[id];
}
