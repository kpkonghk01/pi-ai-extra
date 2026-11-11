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
  | "gemini-nano-banana-2.1"
  | "gpt-image-2"
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-sunburst"
  | "gpt-image-2.6-flare"
  | "gpt-image-2.6-sunburst"
  | "doubao-seedream-5-0-pro"
  | "doubao-seedream-5-5";

export type ToapisGeminiAspectRatio =
  | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "16:9" | "9:16" | "5:4" | "4:5" | "21:9" | "1:4" | "4:1" | "1:8" | "8:1";
export type ToapisGptImage2AspectRatio =
  | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "2:1" | "1:2" | "21:9" | "9:21";
export type ToapisGptImage25AspectRatio = "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "21:9";
export type ToapisGptImage26AspectRatio = ToapisGptImage25AspectRatio;
export type ToapisSeedreamAspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3" | "21:9" | "9:21";
export type ToapisResolution = "1K" | "2K" | "4K";
export type ToapisSeedreamResolution = "1K" | "2K";
export type ToapisSeedream55AspectRatio = "auto" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3" | "21:9";
export type ToapisSeedream55Background = "auto" | "opaque" | "transparent";
export type ToapisSeedream55OutputFormat = "png" | "jpeg";

/** Validated, provider-neutral view of a ToAPIs request before it becomes the generation body. */
export interface NormalizedToapisRequest {
  model: string;
  prompt: string;
  referenceImages: string[];
  aspectRatio?: string | undefined;
  resolution?: string | undefined;
  background?: string | undefined;
  outputFormat?: string | undefined;
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
// GPT Image 2.6's standard tier does not take size auto: on 2026-11-11 both models answered it with
// HTTP 503 (model_not_found, "no available service"), and ToAPIs' docs now say so. It is not offered.
const GPT_IMAGE_26_RATIOS = GPT_IMAGE_25_RATIOS;
const SEEDREAM_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21"] as const;
const SEEDREAM_55_RATIOS = ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"] as const;
const RESOLUTIONS = ["1K", "2K", "4K"] as const;
// Seedream 5.5 also takes 1.5K, at the 1K price; it is left out because the image kit's options and prices have no 1.5K tier.
const SEEDREAM_RESOLUTIONS = ["1K", "2K"] as const;
/** ToAPIs' Seedream 5.5 default when `size` is omitted; an explicit ratio is sent at this tier too. */
const SEEDREAM_55_DEFAULT_RESOLUTION: ToapisSeedreamResolution = "2K";
const SEEDREAM_55_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
const SEEDREAM_55_FORMATS = ["png", "jpeg"] as const;
const TRANSPARENT = ["transparent"] as const;

/**
 * The pixels Seedream maps each aspect ratio to at a resolution tier: Volcengine's table for
 * Seedream 5.0 pro / flash (`referenc-docs/volcengine/volcengine-seedream-image-size-doc.md`).
 * Seedream 5.5's `size` takes a tier or explicit pixels but no ratio, so an explicit ratio is
 * sent as these pixels. Checked on 2026-11-11: KIE's Seedream 5.5 rendered 16:9 at 1K as
 * 1424x800, and ToAPIs billed an explicit 1424x800 at its 1K price.
 */
const SEEDREAM_55_PIXELS: Record<ToapisSeedreamResolution, Record<Exclude<ToapisSeedream55AspectRatio, "auto">, string>> = {
  "1K": {
    "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1424x800",
    "9:16": "800x1424", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672",
  },
  "2K": {
    "1:1": "2048x2048", "4:3": "2368x1776", "3:4": "1776x2368", "16:9": "2816x1584",
    "9:16": "1584x2816", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344",
  },
};

/**
 * ToAPIs' upload endpoint takes files up to 30 MB (its docs, 2026-11-11), but Seedream 5.0 Pro
 * takes references of at most 10 MB, so inline references stay at 10 MB for every model.
 */
const INLINE_LIMIT_BYTES = 10 * 1024 * 1024;
const COMMON_TYPES: readonly ImageMimeType[] = ["image/png", "image/jpeg", "image/webp"];

function references(max: number | null, acceptedMimeTypes: readonly ImageMimeType[] = COMMON_TYPES): ReferenceImageSpec {
  return { min: 0, max, acceptedMimeTypes, maxInlineBytes: INLINE_LIMIT_BYTES };
}

function info(fields: Omit<ImageModelInfo, "provider" | "kind" | "familyId" | "familyName" | "operationRole" | "background" | "outputFormat" | "watermark"> & Partial<ImageModelInfo>): ImageModelInfo {
  return {
    provider: TOAPIS_PROVIDER_ID,
    kind: "text-and-image-to-image",
    familyId: fields.id,
    familyName: fields.name,
    operationRole: "unified",
    background: null,
    outputFormat: null,
    watermark: false,
    ...fields,
  };
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

function gptImage26(id: "gpt-image-2.6-flare" | "gpt-image-2.6-sunburst"): ToapisModelDefinition {
  const model = info({
    id,
    name: id === "gpt-image-2.6-flare" ? "GPT Image 2.6 Flare" : "GPT Image 2.6 Sunburst",
    promptMaxLength: null,
    referenceImages: references(10),
    aspectRatio: option(GPT_IMAGE_26_RATIOS, "1:1"),
    resolution: option(RESOLUTIONS, "1K"),
    background: option(TRANSPARENT, null),
    notes: [
      "Up to 10 reference images.",
      "Quality is fixed to high by ToAPIs.",
    ],
  });
  return {
    info: model,
    schema: z.strictObject({
      ...baseRequestShape(model),
      aspectRatio: z.enum(GPT_IMAGE_26_RATIOS).optional(),
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

/** Seedream 5.5 `size`: the tier for `auto` (or no ratio), otherwise the ratio's pixels at the tier. */
function seedream55Size(aspectRatio: string | undefined, resolution: string | undefined): string | undefined {
  if (aspectRatio === undefined || aspectRatio === "auto") return resolution;
  const tier = (resolution ?? SEEDREAM_55_DEFAULT_RESOLUTION) as ToapisSeedreamResolution;
  return SEEDREAM_55_PIXELS[tier][aspectRatio as Exclude<ToapisSeedream55AspectRatio, "auto">];
}

/** ToAPIs renders a transparent Seedream 5.5 background only as PNG. */
function refineSeedream55(request: NormalizedToapisRequest, ctx: z.RefinementCtx): void {
  if (request.background === "transparent" && request.outputFormat === "jpeg") {
    ctx.addIssue({ code: "custom", path: ["background"], message: "background transparent requires outputFormat png" });
  }
}

const GEMINI_NANO_BANANA_21 = info({
  id: "gemini-nano-banana-2.1",
  name: "Gemini Nano Banana 2.1",
  promptMaxLength: null,
  referenceImages: references(14),
  aspectRatio: option(GEMINI_RATIOS, null),
  resolution: option(RESOLUTIONS, "1K"),
  notes: ["Up to 14 reference images."],
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

const SEEDREAM_55 = info({
  id: "doubao-seedream-5-5",
  name: "Seedream 5.5",
  promptMaxLength: null,
  referenceImages: references(10, ["image/png", "image/jpeg"]),
  aspectRatio: option(SEEDREAM_55_RATIOS, "auto"),
  resolution: option(SEEDREAM_RESOLUTIONS, SEEDREAM_55_DEFAULT_RESOLUTION),
  background: option(SEEDREAM_55_BACKGROUNDS, "auto"),
  outputFormat: option(SEEDREAM_55_FORMATS, "png"),
  watermark: true,
  notes: [
    "Reference images: JPEG or PNG; they are not billed.",
    "aspectRatio auto sends only the resolution: the model chooses the ratio, or follows the reference image.",
    "background transparent requires outputFormat png.",
  ],
});

const DEFINITIONS: Record<ToapisImageModelId, ToapisModelDefinition> = {
  "gemini-nano-banana-2.1": {
    info: GEMINI_NANO_BANANA_21,
    schema: z.strictObject({
      ...baseRequestShape(GEMINI_NANO_BANANA_21),
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
  "gpt-image-2.6-flare": gptImage26("gpt-image-2.6-flare"),
  "gpt-image-2.6-sunburst": gptImage26("gpt-image-2.6-sunburst"),
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
  "doubao-seedream-5-5": {
    info: SEEDREAM_55,
    schema: z
      .strictObject({
        ...baseRequestShape(SEEDREAM_55),
        aspectRatio: z.enum(SEEDREAM_55_RATIOS).optional(),
        resolution: z.enum(SEEDREAM_RESOLUTIONS).optional(),
        background: z.enum(SEEDREAM_55_BACKGROUNDS).optional(),
        outputFormat: z.enum(SEEDREAM_55_FORMATS).optional(),
        watermark: z.boolean().optional(),
      })
      .superRefine(refineSeedream55),
    buildBody: (request, imageUrls) => {
      const metadata = omitUndefined({ output_format: request.outputFormat, background: request.background, watermark: request.watermark });
      return omitUndefined({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        size: seedream55Size(request.aspectRatio, request.resolution),
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
