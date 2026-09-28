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
  | "nano-banana-2";

export type KieGrokAspectRatio = "1:1" | "2:3" | "3:2" | "16:9" | "9:16";
export type KieGrokEditAspectRatio = KieGrokAspectRatio | "auto";
export type KieGptImage2AspectRatio =
  | "auto" | "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5"
  | "16:9" | "9:16" | "2:1" | "1:2" | "3:1" | "1:3" | "21:9" | "9:21";
export type KieResolution = "1K" | "2K" | "4K";
export type KieGptImage2Background = "transparent" | "opaque" | "auto";
export type KieNanoBanana2AspectRatio =
  | "1:1" | "2:3" | "3:2" | "1:4" | "4:1" | "3:4" | "4:3" | "4:5"
  | "5:4" | "1:8" | "8:1" | "9:16" | "16:9" | "21:9" | "auto";
export type KieNanoBanana2OutputFormat = "png" | "jpg";

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

/** KIE's base64 upload is intended for images up to about 10 MB. */
const INLINE_LIMIT_BYTES = 10 * 1024 * 1024;

function references(min: number, max: number | null): ReferenceImageSpec {
  return { min, max, acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"], maxInlineBytes: INLINE_LIMIT_BYTES };
}

function info(fields: Omit<ImageModelInfo, "provider" | "background" | "outputFormat" | "resolution" | "watermark"> & Partial<ImageModelInfo>): ImageModelInfo {
  return { provider: KIE_PROVIDER_ID, resolution: null, background: null, outputFormat: null, watermark: false, ...fields };
}

/** Enforces KIE's documented GPT Image 2 aspect-ratio/resolution/background combinations. */
function refineGptImage2(request: NormalizedKieRequest, ctx: z.RefinementCtx): void {
  const ratio = request.aspectRatio ?? "auto";
  const resolution = request.resolution;
  const fail = (path: string, message: string): void => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  if (resolution === "2K" && ["5:4", "4:5", "3:1", "1:3", "9:21"].includes(ratio)) fail("aspectRatio", `${ratio} is not supported at 2K`);
  if (resolution === "4K" && ["1:1", "3:1", "1:3", "9:21"].includes(ratio)) fail("aspectRatio", `${ratio} is not supported at 4K`);
  if (ratio === "auto" && resolution !== undefined && resolution !== "1K") fail("resolution", "aspectRatio auto (or omitted) only supports 1K");
  if (request.background !== undefined && resolution !== undefined && resolution !== "1K") fail("background", "background is only supported at 1K");
}

function gptImage2(id: "gpt-image-2-text-to-image" | "gpt-image-2-image-to-image"): KieModelDefinition {
  const imageToImage = id === "gpt-image-2-image-to-image";
  const model = info({
    id,
    name: imageToImage ? "GPT Image 2 (image to image)" : "GPT Image 2 (text to image)",
    kind: imageToImage ? "image-to-image" : "text-to-image",
    promptMaxLength: 20_000,
    referenceImages: imageToImage ? references(1, 16) : references(0, 0),
    aspectRatio: option(GPT_IMAGE_2_RATIOS, "auto"),
    resolution: option(RESOLUTIONS, null),
    background: option(GPT_BACKGROUNDS, null),
    notes: [
      "2K does not support 5:4, 4:5, 3:1, 1:3 or 9:21.",
      "4K does not support 1:1, 3:1, 1:3 or 9:21.",
      "aspectRatio auto (or omitted) only supports 1K.",
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

const GROK_TEXT = info({
  id: "grok-imagine-image-2-0/text-to-image",
  name: "Grok Imagine Image 2.0 (text to image)",
  kind: "text-to-image",
  promptMaxLength: null,
  referenceImages: references(0, 0),
  aspectRatio: option(GROK_RATIOS, null, true),
  notes: ["aspectRatio is required."],
});

const GROK_EDIT = info({
  id: "grok-imagine-image-2-0/image-edit",
  name: "Grok Imagine Image 2.0 (image edit)",
  kind: "image-to-image",
  promptMaxLength: 8_000,
  referenceImages: references(1, 5),
  aspectRatio: option(GROK_EDIT_RATIOS, null, true),
  notes: ["aspectRatio is required; use auto to follow the input image."],
});

const NANO_BANANA_2 = info({
  id: "nano-banana-2",
  name: "Nano Banana 2",
  kind: "text-and-image-to-image",
  promptMaxLength: 20_000,
  referenceImages: references(0, 14),
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
  "nano-banana-2": {
    info: NANO_BANANA_2,
    schema: z.strictObject({
      ...baseRequestShape(NANO_BANANA_2),
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
};

export const KIE_IMAGE_MODEL_IDS: readonly KieImageModelId[] = Object.keys(DEFINITIONS) as KieImageModelId[];

/** Catalogue of supported KIE image model operations and their documented constraints. */
export const KIE_IMAGE_MODELS: readonly ImageModelInfo[] = KIE_IMAGE_MODEL_IDS.map((id) => DEFINITIONS[id].info);

export function kieModelDefinition(id: KieImageModelId): KieModelDefinition {
  return DEFINITIONS[id];
}
