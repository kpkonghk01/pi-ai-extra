import { z } from "zod";
import {
  baseRequestShape,
  omitUndefined,
  option,
  type ImageModelInfo,
  type ReferenceImageSpec,
} from "@hk01/pi-ai-extra-internal";
import { KIE_PROVIDER_ID } from "./constants.ts";

export type KieImageModelId =
  | "grok-imagine-image-2-0/text-to-image"
  | "grok-imagine-image-2-0/image-edit"
  | "gpt-image-2-text-to-image"
  | "gpt-image-2-image-to-image"
  | "nano-banana-2-1"
  | "seedream/5-5-text-to-image"
  | "seedream/5-5-image-to-image";

export type KieGrokAspectRatio = "1:1" | "2:3" | "3:2" | "16:9" | "9:16";
export type KieGrokEditAspectRatio = KieGrokAspectRatio | "auto";
export type KieGptImage2AspectRatio =
  | "auto" | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5"
  | "16:9" | "9:16" | "2:1" | "1:2" | "3:1" | "1:3" | "21:9" | "9:21";
export type KieResolution = "1K" | "2K" | "4K";
export type KieGptImage2Background = "transparent" | "opaque" | "auto";
export type KieNanoBanana21AspectRatio =
  | "1:1" | "2:3" | "3:2" | "1:4" | "4:1" | "3:4" | "4:3" | "4:5"
  | "5:4" | "1:8" | "8:1" | "9:16" | "16:9" | "21:9" | "auto";
export type KieNanoBanana21OutputFormat = "png" | "jpg";
export type KieSeedream55AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "2:3" | "3:2" | "21:9";
export type KieSeedream55ImageToImageAspectRatio = KieSeedream55AspectRatio | "auto";
export type KieSeedream55Resolution = "1K" | "2K";
export type KieSeedream55Background = "auto" | "transparent" | "opaque";
export type KieSeedream55OutputFormat = "png" | "jpeg";

/** Validated, provider-neutral view of a KIE request before it is mapped to the model's `input` fields. */
export interface NormalizedKieRequest {
  model: string;
  prompt: string;
  referenceImages: string[];
  aspectRatio?: string | undefined;
  resolution?: string | undefined;
  background?: string | undefined;
  outputFormat?: string | undefined;
}

interface KieModelDefinition {
  info: ImageModelInfo;
  schema: z.ZodType<NormalizedKieRequest>;
  buildInput: (request: NormalizedKieRequest, imageUrls: readonly string[]) => Record<string, unknown>;
}

const GROK_RATIOS = ["1:1", "2:3", "3:2", "16:9", "9:16"] as const;
const GROK_EDIT_RATIOS = [...GROK_RATIOS, "auto"] as const;
const GPT_IMAGE_2_RATIOS = [
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
] as const;
const RESOLUTIONS = ["1K", "2K", "4K"] as const;
const GPT_BACKGROUNDS = ["transparent", "opaque", "auto"] as const;
const NANO_RATIOS = ["1:1", "2:3", "3:2", "1:4", "4:1", "3:4", "4:3", "4:5", "5:4", "1:8", "8:1", "9:16", "16:9", "21:9", "auto"] as const;
const NANO_FORMATS = ["png", "jpg"] as const;
const SEEDREAM_55_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
const SEEDREAM_55_IMAGE_TO_IMAGE_RATIOS = [...SEEDREAM_55_RATIOS, "auto"] as const;
// KIE also offers 1.5K, at the 1K price; it is left out because the image kit's options and prices have no 1.5K tier.
const SEEDREAM_55_RESOLUTIONS = ["1K", "2K"] as const;
const SEEDREAM_55_BACKGROUNDS = ["auto", "transparent", "opaque"] as const;
const SEEDREAM_55_FORMATS = ["png", "jpeg"] as const;

/** KIE's base64 upload is intended for images up to about 10 MB. */
const INLINE_LIMIT_BYTES = 10 * 1024 * 1024;

function references(min: number, max: number | null): ReferenceImageSpec {
  return { min, max, acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"], maxInlineBytes: INLINE_LIMIT_BYTES };
}

function info(fields: Omit<ImageModelInfo, "provider" | "familyId" | "familyName" | "operationRole" | "background" | "outputFormat" | "resolution" | "watermark"> & Partial<ImageModelInfo>): ImageModelInfo {
  return {
    provider: KIE_PROVIDER_ID,
    familyId: fields.id,
    familyName: fields.name,
    operationRole: fields.kind === "text-to-image" ? "text-to-image" : fields.kind === "image-to-image" ? "image-to-image" : "unified",
    resolution: null,
    background: null,
    outputFormat: null,
    watermark: false,
    ...fields,
  };
}

/**
 * Enforces KIE's documented GPT Image 2 aspect-ratio/resolution/background combinations. KIE's
 * docs no longer limit 1:1 at 4K or auto to 1K; on 2026-11-11, 1:1 at 4K and auto at 2K and 4K
 * rendered, and 3:1 at 4K was still refused.
 */
function refineGptImage2(request: NormalizedKieRequest, ctx: z.RefinementCtx): void {
  const ratio = request.aspectRatio ?? "auto";
  const resolution = request.resolution;
  const fail = (path: string, message: string): void => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  if (resolution === "2K" && ["5:4", "4:5", "3:1", "1:3", "9:21"].includes(ratio)) fail("aspectRatio", `${ratio} is not supported at 2K`);
  if (resolution === "4K" && ["3:1", "1:3", "9:21"].includes(ratio)) fail("aspectRatio", `${ratio} is not supported at 4K`);
  if (request.background !== undefined && resolution !== undefined && resolution !== "1K") fail("background", "background is only supported at 1K");
}

function gptImage2(id: "gpt-image-2-text-to-image" | "gpt-image-2-image-to-image"): KieModelDefinition {
  const imageToImage = id === "gpt-image-2-image-to-image";
  const model = info({
    id,
    name: imageToImage ? "GPT Image 2 (image to image)" : "GPT Image 2 (text to image)",
    kind: imageToImage ? "image-to-image" : "text-to-image",
    familyId: "gpt-image-2",
    familyName: "GPT Image 2",
    operationRole: imageToImage ? "image-to-image" : "text-to-image",
    promptMaxLength: 20_000,
    referenceImages: imageToImage ? references(1, 16) : references(0, 0),
    aspectRatio: option(GPT_IMAGE_2_RATIOS, "auto"),
    resolution: option(RESOLUTIONS, null),
    background: option(GPT_BACKGROUNDS, null),
    notes: [
      "2K does not support 5:4, 4:5, 3:1, 1:3 or 9:21.",
      "4K does not support 3:1, 1:3 or 9:21.",
      "background is only supported at 1K.",
    ],
  });
  return {
    info: model,
    schema: z
      .strictObject({
        ...baseRequestShape(model),
        aspectRatio: z.enum(GPT_IMAGE_2_RATIOS).optional(),
        resolution: z.enum(RESOLUTIONS).optional(),
        background: z.enum(GPT_BACKGROUNDS).optional(),
      })
      .superRefine(refineGptImage2),
    buildInput: (request, imageUrls) =>
      omitUndefined({
        prompt: request.prompt,
        input_urls: imageToImage ? [...imageUrls] : undefined,
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
        background: request.background,
      }),
  };
}

/** KIE's Seedream 5.5 prompt needs at least 5 characters, and KIE renders a transparent background only as PNG. */
function refineSeedream55(request: NormalizedKieRequest, ctx: z.RefinementCtx): void {
  if (request.prompt.length < 5) {
    ctx.addIssue({ code: "custom", path: ["prompt"], message: "prompt needs at least 5 characters" });
  }
  if (request.background === "transparent" && request.outputFormat === "jpeg") {
    ctx.addIssue({ code: "custom", path: ["background"], message: "background transparent requires outputFormat png" });
  }
}

function seedream55(id: "seedream/5-5-text-to-image" | "seedream/5-5-image-to-image"): KieModelDefinition {
  const imageToImage = id === "seedream/5-5-image-to-image";
  const model = info({
    id,
    name: imageToImage ? "Seedream 5.5 (image to image)" : "Seedream 5.5 (text to image)",
    kind: imageToImage ? "image-to-image" : "text-to-image",
    familyId: "seedream-5-5",
    familyName: "Seedream 5.5",
    operationRole: imageToImage ? "image-to-image" : "text-to-image",
    promptMaxLength: 5_000,
    referenceImages: imageToImage ? references(1, 10) : references(0, 0),
    aspectRatio: imageToImage ? option(SEEDREAM_55_IMAGE_TO_IMAGE_RATIOS, "auto") : option(SEEDREAM_55_RATIOS, null, true),
    resolution: option(SEEDREAM_55_RESOLUTIONS, "2K"),
    background: option(SEEDREAM_55_BACKGROUNDS, "auto"),
    outputFormat: option(SEEDREAM_55_FORMATS, "png"),
    notes: [
      imageToImage ? "Reference images: JPEG, PNG or WebP, up to 10 MB each; KIE bills each input image." : "aspectRatio is required.",
      "The prompt needs at least 5 characters.",
      "background transparent requires outputFormat png.",
    ],
  });
  return {
    info: model,
    schema: z
      .strictObject({
        ...baseRequestShape(model),
        aspectRatio: imageToImage ? z.enum(SEEDREAM_55_IMAGE_TO_IMAGE_RATIOS).optional() : z.enum(SEEDREAM_55_RATIOS),
        resolution: z.enum(SEEDREAM_55_RESOLUTIONS).optional(),
        background: z.enum(SEEDREAM_55_BACKGROUNDS).optional(),
        outputFormat: z.enum(SEEDREAM_55_FORMATS).optional(),
      })
      .superRefine(refineSeedream55),
    buildInput: (request, imageUrls) =>
      omitUndefined({
        prompt: request.prompt,
        image_urls: imageToImage ? [...imageUrls] : undefined,
        aspect_ratio: request.aspectRatio,
        size: request.resolution,
        background: request.background,
        output_format: request.outputFormat,
      }),
  };
}

const GROK_TEXT = info({
  id: "grok-imagine-image-2-0/text-to-image",
  name: "Grok Imagine Image 2.0 (text to image)",
  kind: "text-to-image",
  familyId: "grok-imagine-image-2-0",
  familyName: "Grok Imagine Image 2.0",
  operationRole: "text-to-image",
  promptMaxLength: 8_000,
  referenceImages: references(0, 0),
  aspectRatio: option(GROK_RATIOS, null, true),
  notes: ["aspectRatio is required."],
});

const GROK_EDIT = info({
  id: "grok-imagine-image-2-0/image-edit",
  name: "Grok Imagine Image 2.0 (image edit)",
  kind: "image-to-image",
  familyId: "grok-imagine-image-2-0",
  familyName: "Grok Imagine Image 2.0",
  operationRole: "image-to-image",
  promptMaxLength: 8_000,
  referenceImages: references(1, 5),
  aspectRatio: option(GROK_EDIT_RATIOS, null, true),
  notes: ["aspectRatio is required; use auto to follow the input image."],
});

const NANO_BANANA_21 = info({
  id: "nano-banana-2-1",
  name: "Nano Banana 2.1",
  kind: "text-and-image-to-image",
  promptMaxLength: 20_000,
  referenceImages: references(0, 10),
  aspectRatio: option(NANO_RATIOS, "auto"),
  resolution: option(RESOLUTIONS, "1K"),
  outputFormat: option(NANO_FORMATS, "jpg"),
  notes: ["Reference images: JPEG, PNG or WebP, up to 30 MB each when passed by URL."],
});

const DEFINITIONS: Record<KieImageModelId, KieModelDefinition> = {
  "grok-imagine-image-2-0/text-to-image": {
    info: GROK_TEXT,
    schema: z.strictObject({ ...baseRequestShape(GROK_TEXT), aspectRatio: z.enum(GROK_RATIOS) }),
    buildInput: (request) => ({ prompt: request.prompt, aspect_ratio: request.aspectRatio }),
  },
  "grok-imagine-image-2-0/image-edit": {
    info: GROK_EDIT,
    schema: z.strictObject({ ...baseRequestShape(GROK_EDIT), aspectRatio: z.enum(GROK_EDIT_RATIOS) }),
    buildInput: (request, imageUrls) => ({ prompt: request.prompt, aspect_ratio: request.aspectRatio, image_urls: [...imageUrls] }),
  },
  "gpt-image-2-text-to-image": gptImage2("gpt-image-2-text-to-image"),
  "gpt-image-2-image-to-image": gptImage2("gpt-image-2-image-to-image"),
  "nano-banana-2-1": {
    info: NANO_BANANA_21,
    schema: z.strictObject({
      ...baseRequestShape(NANO_BANANA_21),
      aspectRatio: z.enum(NANO_RATIOS).optional(),
      resolution: z.enum(RESOLUTIONS).optional(),
      outputFormat: z.enum(NANO_FORMATS).optional(),
    }),
    buildInput: (request, imageUrls) =>
      omitUndefined({
        prompt: request.prompt,
        image_input: [...imageUrls],
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
        output_format: request.outputFormat,
      }),
  },
  "seedream/5-5-text-to-image": seedream55("seedream/5-5-text-to-image"),
  "seedream/5-5-image-to-image": seedream55("seedream/5-5-image-to-image"),
};

export const KIE_IMAGE_MODEL_IDS: readonly KieImageModelId[] = Object.keys(DEFINITIONS) as KieImageModelId[];

/** Catalogue of supported KIE image model operations and their documented constraints. */
export const KIE_IMAGE_MODELS: readonly ImageModelInfo[] = KIE_IMAGE_MODEL_IDS.map((id) => DEFINITIONS[id].info);

export function kieModelDefinition(id: KieImageModelId): KieModelDefinition {
  return DEFINITIONS[id];
}
