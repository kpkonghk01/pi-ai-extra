import { z } from "zod";
import {
  baseRequestShape,
  omitUndefined,
  option,
  type ImageMimeType,
  type ImageModelInfo,
  type ReferenceImageSpec,
} from "@hk01/pi-ai-extra-internal";
import { TOAPIS_PROVIDER_ID } from "./constants.ts";

export type ToapisImageModelId =
  | "gemini-3.1-flash-image-preview"
  | "gpt-image-2"
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-sunburst"
  | "doubao-seedream-5-0-pro";

export type ToapisGeminiAspectRatio =
  | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16" | "5:4" | "4:5" | "21:9" | "1:4" | "4:1" | "1:8" | "8:1";
export type ToapisGptImage2AspectRatio =
  | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "2:1" | "1:2" | "21:9" | "9:21";
export type ToapisGptImage25AspectRatio = "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "21:9";
export type ToapisSeedreamAspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3" | "21:9" | "9:21";
export type ToapisResolution = "1K" | "2K" | "4K";
export type ToapisSeedreamResolution = "1K" | "2K";

/** Validated, provider-neutral view of a ToAPIs request before it becomes the generation body. */
export interface NormalizedToapisRequest {
  model: string;
  prompt: string;
  referenceImages: string[];
  aspectRatio?: string | undefined;
  resolution?: string | undefined;
  background?: string | undefined;
  watermark?: boolean | undefined;
}

interface ToapisModelDefinition {
  info: ImageModelInfo;
  schema: z.ZodType<NormalizedToapisRequest>;
  buildBody: (request: NormalizedToapisRequest, imageUrls: readonly string[]) => Record<string, unknown>;
}

const GEMINI_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"] as const;
const GPT_IMAGE_2_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"] as const;
const GPT_IMAGE_25_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"] as const;
const SEEDREAM_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21"] as const;
const RESOLUTIONS = ["1K", "2K", "4K"] as const;
const SEEDREAM_RESOLUTIONS = ["1K", "2K"] as const;
const TRANSPARENT = ["transparent"] as const;

/** ToAPIs' upload endpoint accepts files up to 10 MB. */
const INLINE_LIMIT_BYTES = 10 * 1024 * 1024;
const COMMON_TYPES: readonly ImageMimeType[] = ["image/png", "image/jpeg", "image/webp"];

function references(max: number | null, acceptedMimeTypes: readonly ImageMimeType[] = COMMON_TYPES): ReferenceImageSpec {
  return { min: 0, max, acceptedMimeTypes, maxInlineBytes: INLINE_LIMIT_BYTES };
}

function info(fields: Omit<ImageModelInfo, "provider" | "kind" | "background" | "outputFormat" | "watermark"> & Partial<ImageModelInfo>): ImageModelInfo {
  return { provider: TOAPIS_PROVIDER_ID, kind: "text-and-image-to-image", background: null, outputFormat: null, watermark: false, ...fields };
}

function nonEmpty(values: readonly string[]): string[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

function gptImage25(id: "gpt-image-2.5-flare" | "gpt-image-2.5-sunburst"): ToapisModelDefinition {
  const model = info({
    id,
    name: id === "gpt-image-2.5-flare" ? "GPT Image 2.5 Flare" : "GPT Image 2.5 Sunburst",
    promptMaxLength: null,
    referenceImages: references(null),
    aspectRatio: option(GPT_IMAGE_25_RATIOS, "1:1"),
    resolution: option(RESOLUTIONS, "1K"),
    background: option(TRANSPARENT, null),
    notes: [
      "ToAPIs documents no reference-image limit for this model; the provider validates the count.",
      "Quality is fixed to high by ToAPIs.",
    ],
  });
  return {
    info: model,
    schema: z.strictObject({
      ...baseRequestShape(model),
      aspectRatio: z.enum(GPT_IMAGE_25_RATIOS).optional(),
      resolution: z.enum(RESOLUTIONS).optional(),
      background: z.enum(TRANSPARENT).optional(),
    }),
    buildBody: (request, imageUrls) =>
      omitUndefined({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: request.aspectRatio,
        resolution: request.resolution,
        background: request.background,
        reference_images: nonEmpty(imageUrls),
      }),
  };
}

const GEMINI_FLASH = info({
  id: "gemini-3.1-flash-image-preview",
  name: "Gemini 3.1 Flash Image (Nano Banana 2)",
  promptMaxLength: null,
  referenceImages: references(6),
  aspectRatio: option(GEMINI_RATIOS, null),
  resolution: option(RESOLUTIONS, "1K"),
  notes: ["Standard tier: up to 6 reference images."],
});

const GPT_IMAGE_2 = info({
  id: "gpt-image-2",
  name: "GPT Image 2",
  promptMaxLength: 32_000,
  referenceImages: references(6),
  aspectRatio: option(GPT_IMAGE_2_RATIOS, "1:1"),
  resolution: option(RESOLUTIONS, "1K"),
  background: option(TRANSPARENT, null),
  notes: ["Omit background for a normal (opaque) image."],
});

const SEEDREAM = info({
  id: "doubao-seedream-5-0-pro",
  name: "Seedream 5.0 Pro",
  promptMaxLength: null,
  referenceImages: references(10, ["image/png", "image/jpeg"]),
  aspectRatio: option(SEEDREAM_RATIOS, "1:1"),
  resolution: option(SEEDREAM_RESOLUTIONS, "2K"),
  watermark: true,
  notes: [
    "Reference images: JPEG or PNG, aspect ratio between 1/3 and 3, at most 6000x6000 px.",
    "The first reference image is free; later ones are billed.",
  ],
});

const DEFINITIONS: Record<ToapisImageModelId, ToapisModelDefinition> = {
  "gemini-3.1-flash-image-preview": {
    info: GEMINI_FLASH,
    schema: z.strictObject({
      ...baseRequestShape(GEMINI_FLASH),
      aspectRatio: z.enum(GEMINI_RATIOS).optional(),
      resolution: z.enum(RESOLUTIONS).optional(),
    }),
    buildBody: (request, imageUrls) =>
      omitUndefined({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: request.aspectRatio,
        image_urls: nonEmpty(imageUrls),
        metadata: request.resolution ? { resolution: request.resolution } : undefined,
      }),
  },
  "gpt-image-2": {
    info: GPT_IMAGE_2,
    schema: z.strictObject({
      ...baseRequestShape(GPT_IMAGE_2),
      aspectRatio: z.enum(GPT_IMAGE_2_RATIOS).optional(),
      resolution: z.enum(RESOLUTIONS).optional(),
      background: z.enum(TRANSPARENT).optional(),
    }),
    buildBody: (request, imageUrls) =>
      omitUndefined({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: request.aspectRatio,
        // gpt-image-2 documents lowercase resolution tiers.
        resolution: request.resolution?.toLowerCase(),
        background: request.background,
        response_format: "url",
        reference_images: nonEmpty(imageUrls),
      }),
  },
  "gpt-image-2.5-flare": gptImage25("gpt-image-2.5-flare"),
  "gpt-image-2.5-sunburst": gptImage25("gpt-image-2.5-sunburst"),
  "doubao-seedream-5-0-pro": {
    info: SEEDREAM,
    schema: z.strictObject({
      ...baseRequestShape(SEEDREAM),
      aspectRatio: z.enum(SEEDREAM_RATIOS).optional(),
      resolution: z.enum(SEEDREAM_RESOLUTIONS).optional(),
      watermark: z.boolean().optional(),
    }),
    buildBody: (request, imageUrls) => {
      const metadata = omitUndefined({ resolution: request.resolution, watermark: request.watermark });
      return omitUndefined({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: request.aspectRatio,
        image_urls: nonEmpty(imageUrls),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    },
  },
};

export const TOAPIS_IMAGE_MODEL_IDS: readonly ToapisImageModelId[] = Object.keys(DEFINITIONS) as ToapisImageModelId[];

/** Catalogue of supported ToAPIs image models and their documented constraints. */
export const TOAPIS_IMAGE_MODELS: readonly ImageModelInfo[] = TOAPIS_IMAGE_MODEL_IDS.map((id) => DEFINITIONS[id].info);

export function toapisModelDefinition(id: ToapisImageModelId): ToapisModelDefinition {
  return DEFINITIONS[id];
}
