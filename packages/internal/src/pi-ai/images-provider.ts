import {
  createImagesProvider,
  type AssistantImages,
  type ImageContent,
  type ImagesContext,
  type ImagesModel,
  type ImagesOptions,
  type ImagesProvider,
} from "@earendil-works/pi-ai";
import type { ImageModelInfo } from "../catalog.ts";
import type { FetchLike } from "../context.ts";
import { isPiAiExtraError } from "../errors.ts";
import { toDataUrl } from "../image-data.ts";
import type { ImageGenerationResult } from "../result.ts";
import { explicitApiKeyAuth } from "./auth.ts";

/** Keys a pi-ai caller may not set through `options.metadata`; they come from the request itself. */
const RESERVED_METADATA_KEYS = ["apiKey", "signal", "fetch", "onProgress", "model", "prompt", "referenceImages"] as const;

export interface HelperImageRequest {
  model: string;
  prompt: string;
  referenceImages: string[];
  apiKey: string;
  signal: AbortSignal | undefined;
  fetch: FetchLike | undefined;
  /** Model options from `ImagesOptions.metadata`, validated strictly by the helper schema. */
  params: Record<string, unknown>;
}

export interface HelperImagesProviderInput {
  id: string;
  name: string;
  /** pi-ai images API id carried on every model. */
  api: string;
  baseUrl: string;
  apiKey: string;
  models: readonly ImageModelInfo[];
  generate: (request: HelperImageRequest) => Promise<ImageGenerationResult>;
}

/**
 * Bridges a high-level image helper into pi-ai's `ImagesProvider` contract.
 * Errors are returned as `stopReason: "error"` (or `"aborted"`), never thrown.
 */
export function createHelperImagesProvider(input: HelperImagesProviderInput): ImagesProvider {
  const models = input.models.map((info) => toImagesModel(info, input));
  return createImagesProvider({
    id: input.id,
    name: input.name,
    auth: explicitApiKeyAuth(input.name, input.apiKey),
    models,
    api: {
      generateImages: (model, context, options) => generateThroughHelper(input, model, context, options),
    },
  });
}

async function generateThroughHelper(
  input: HelperImagesProviderInput,
  model: ImagesModel<string>,
  context: ImagesContext,
  options: ImagesOptions | undefined,
): Promise<AssistantImages> {
  const base = { api: model.api, provider: model.provider, model: model.id };
  try {
    const params = { ...(options?.metadata ?? {}) };
    const reserved = RESERVED_METADATA_KEYS.filter((key) => key in params);
    if (reserved.length > 0) {
      throw new Error(`[${model.provider}/${model.id}] options.metadata must not set ${reserved.join(", ")}.`);
    }
    const prompt = context.input
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n");
    const referenceImages = context.input.flatMap((part) => (part.type === "image" ? [toDataUrl(part.mimeType, part.data)] : []));
    const result = await input.generate({
      model: model.id,
      prompt,
      referenceImages,
      apiKey: options?.apiKey ?? input.apiKey,
      signal: options?.signal,
      fetch: options?.fetch,
      params,
    });
    const output: ImageContent[] = result.images.map((image) => ({
      type: "image",
      mimeType: image.mimeType,
      data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1),
    }));
    const images: AssistantImages = { ...base, output, stopReason: "stop", timestamp: Date.now() };
    if (result.taskId !== undefined) images.responseId = result.taskId;
    return images;
  } catch (error) {
    const aborted = options?.signal?.aborted === true || (isPiAiExtraError(error) && error.code === "aborted");
    return {
      ...base,
      output: [],
      stopReason: aborted ? "aborted" : "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    };
  }
}

function toImagesModel(info: ImageModelInfo, input: HelperImagesProviderInput): ImagesModel<string> {
  const model: ImagesModel<string> = {
    id: info.id,
    name: info.name,
    api: input.api,
    provider: input.id,
    baseUrl: input.baseUrl,
    input: info.referenceImages.max === 0 ? ["text"] : ["text", "image"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  if (info.referenceImages.max !== null) model.inputLimits = { images: { maxPerRequest: info.referenceImages.max } };
  return model;
}
