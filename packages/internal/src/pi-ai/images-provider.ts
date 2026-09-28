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
import { isPiAiExtraError, PiAiExtraError } from "../errors.ts";
import { toDataUrl } from "../image-data.ts";
import type { ImageGenerationResult } from "../result.ts";
import { explicitApiKeyAuth } from "./auth.ts";
import { toPiAiUsage } from "./usage.ts";

/** Keys a pi-ai caller may not set through `options.metadata`; they come from the request itself. */
const RESERVED_METADATA_KEYS = ["apiKey", "signal", "fetch", "onProgress", "model", "prompt", "referenceImages"] as const;

export interface HelperImagesProviderInput {
  id: string;
  name: string;
  /** pi-ai images API id carried on every model. */
  api: string;
  baseUrl: string;
  apiKey: string;
  models: readonly ImageModelInfo[];
  /** Provider settings applied to every request (for example a base URL or poll cadence). */
  settings?: object | undefined;
  /**
   * The package's helper. It receives `ImagesOptions.metadata` spread first, then the
   * settings, then model/prompt/references/key/signal/fetch, and validates everything strictly.
   */
  generate: (request: Record<string, unknown>) => Promise<ImageGenerationResult>;
}

/**
 * Bridges a high-level image helper into pi-ai's `ImagesProvider` contract.
 * Errors are returned as `stopReason: "error"` (or `"aborted"`), never thrown.
 */
export function createHelperImagesProvider(input: HelperImagesProviderInput): ImagesProvider {
  return createImagesProvider({
    id: input.id,
    name: input.name,
    auth: explicitApiKeyAuth(input.name, input.apiKey),
    models: input.models.map((info) => toImagesModel(info, input)),
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
  let result: ImageGenerationResult;
  try {
    result = await input.generate(helperRequest(input, model, context, options));
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
  // Built outside the try: accounting conversion never turns a finished image into an error.
  const output: ImageContent[] = result.images.map((image) => ({
    type: "image",
    mimeType: image.mimeType,
    data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1),
  }));
  const usage = toPiAiUsage(model, result.usage?.tokens);
  return {
    ...base,
    output,
    stopReason: "stop",
    timestamp: Date.now(),
    ...(result.taskId === undefined ? {} : { responseId: result.taskId }),
    ...(usage ? { usage } : {}),
  };
}

function helperRequest(
  input: HelperImagesProviderInput,
  model: ImagesModel<string>,
  context: ImagesContext,
  options: ImagesOptions | undefined,
): Record<string, unknown> {
  const metadata = options?.metadata ?? {};
  const reserved = RESERVED_METADATA_KEYS.filter((key) => key in metadata);
  if (reserved.length > 0) {
    throw new PiAiExtraError(`options.metadata must not set ${reserved.join(", ")}.`, {
      provider: model.provider,
      model: model.id,
      code: "invalid_request",
      operation: "validate",
    });
  }
  return {
    ...metadata,
    ...input.settings,
    model: model.id,
    prompt: context.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n"),
    referenceImages: context.input.flatMap((part) => (part.type === "image" ? [toDataUrl(part.mimeType, part.data)] : [])),
    apiKey: options?.apiKey ?? input.apiKey,
    signal: options?.signal,
    fetch: options?.fetch,
  };
}

function toImagesModel(info: ImageModelInfo, input: HelperImagesProviderInput): ImagesModel<string> {
  return {
    id: info.id,
    name: info.name,
    api: input.api,
    provider: input.id,
    baseUrl: input.baseUrl,
    input: info.referenceImages.max === 0 ? ["text"] : ["text", "image"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(info.referenceImages.max === null ? {} : { inputLimits: { images: { maxPerRequest: info.referenceImages.max } } }),
  };
}
