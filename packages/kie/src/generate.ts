import { z } from "zod";
import {
  assertApiKey,
  assertSupportedModel,
  createOperationContext,
  emitProgress,
  httpUrlSchema,
  parseRequest,
  pollSchedule,
  resolveReferenceImages,
  runAsyncImageTask,
  splitHelperOptions,
  taskSettingsShape,
  withoutTrailingSlash,
  type ImageGenerationResult,
  type ImageHelperOptions,
  type PollDefaults,
} from "@hk01/pi-ai-extra-internal";
import { createKieTask, uploadToKie, type KieEndpoints } from "./client.ts";
import { KIE_API_BASE_URL, KIE_PROVIDER_ID, KIE_UPLOAD_BASE_URL } from "./constants.ts";
import {
  KIE_IMAGE_MODEL_IDS,
  kieModelDefinition,
  type KieGptImage2AspectRatio,
  type KieGptImage2Background,
  type KieGrokAspectRatio,
  type KieGrokEditAspectRatio,
  type KieImageModelId,
  type KieNanoBanana2AspectRatio,
  type KieNanoBanana2OutputFormat,
  type KieResolution,
} from "./models.ts";
import { waitForKieTask } from "./task.ts";

/** Advanced transport settings. Defaults follow KIE's documentation. */
export interface KieImageSettings {
  /** Market task API host. Default `https://api.kie.ai`. */
  apiBaseUrl?: string | undefined;
  /** File Upload API host. Default `https://kieai.redpandaai.co`. */
  uploadBaseUrl?: string | undefined;
  /** Status polling cadence. Default: 2.5 s, growing 1.5x up to 10 s. */
  poll?: { initialDelayMs?: number | undefined; maxDelayMs?: number | undefined } | undefined;
}

interface KieRequestBase extends ImageHelperOptions, KieImageSettings {
  prompt: string;
  /**
   * Data URLs (uploaded through KIE's File Upload API) or public http(s) URLs (passed through).
   * The count must be within the model's documented limit; nothing is dropped.
   */
  referenceImages?: readonly string[] | undefined;
}

export interface KieGrokTextToImageRequest extends KieRequestBase {
  model: "grok-imagine-image-2-0/text-to-image";
  aspectRatio: KieGrokAspectRatio;
}

export interface KieGrokImageEditRequest extends KieRequestBase {
  model: "grok-imagine-image-2-0/image-edit";
  aspectRatio: KieGrokEditAspectRatio;
}

export interface KieGptImage2Request extends KieRequestBase {
  model: "gpt-image-2-text-to-image" | "gpt-image-2-image-to-image";
  aspectRatio?: KieGptImage2AspectRatio | undefined;
  resolution?: KieResolution | undefined;
  background?: KieGptImage2Background | undefined;
}

export interface KieNanoBanana2Request extends KieRequestBase {
  model: "nano-banana-2";
  aspectRatio?: KieNanoBanana2AspectRatio | undefined;
  resolution?: KieResolution | undefined;
  outputFormat?: KieNanoBanana2OutputFormat | undefined;
}

export type KieImageRequest = KieGrokTextToImageRequest | KieGrokImageEditRequest | KieGptImage2Request | KieNanoBanana2Request;

/** KIE recommends starting at 2-3 s, backing off gradually and stopping after 10-15 minutes. */
const POLL_DEFAULTS: PollDefaults = { initialDelayMs: 2_500, maxDelayMs: 10_000, factor: 1.5, jitterRatio: 0.1, timeoutMs: 10 * 60_000 };

const settingsSchema = z.strictObject({
  ...taskSettingsShape,
  apiBaseUrl: httpUrlSchema.optional(),
  uploadBaseUrl: httpUrlSchema.optional(),
});

/**
 * Generates or edits an image with one KIE model operation: validates the request,
 * uploads inline references through KIE only, creates the task, polls the same task
 * until success/failure/timeout/cancellation, downloads the result and returns data URLs.
 */
export async function generateKieImage(request: KieImageRequest): Promise<ImageGenerationResult> {
  const ctx = createOperationContext({
    provider: KIE_PROVIDER_ID,
    model: String(request.model),
    signal: request.signal,
    fetch: request.fetch,
    onProgress: request.onProgress,
  });
  assertSupportedModel(ctx, request.model, KIE_IMAGE_MODEL_IDS);
  assertApiKey(ctx, request.apiKey);

  const { settings, payload } = splitHelperOptions(request);
  const { apiBaseUrl, uploadBaseUrl, poll, ...modelPayload } = payload;
  const options = parseRequest(ctx, settingsSchema, { apiBaseUrl, uploadBaseUrl, poll, timeoutMs: settings.timeoutMs, maxOutputBytes: settings.maxOutputBytes });
  const definition = kieModelDefinition(request.model as KieImageModelId);
  const parsed = parseRequest(ctx, definition.schema, modelPayload);
  const references = resolveReferenceImages(ctx, parsed.referenceImages, definition.info.referenceImages);
  emitProgress(ctx, { type: "validated", referenceImageCount: references.length });

  const apiKey = request.apiKey;
  const endpoints: KieEndpoints = {
    apiBaseUrl: withoutTrailingSlash(options.apiBaseUrl ?? KIE_API_BASE_URL),
    uploadBaseUrl: withoutTrailingSlash(options.uploadBaseUrl ?? KIE_UPLOAD_BASE_URL),
  };
  return runAsyncImageTask(ctx, {
    references,
    upload: (reference) => uploadToKie(ctx, apiKey, endpoints, reference),
    submit: (imageUrls) => createKieTask(ctx, apiKey, endpoints, parsed.model, definition.buildInput(parsed, imageUrls)),
    wait: (taskId) => waitForKieTask(ctx, apiKey, endpoints.apiBaseUrl, taskId, pollSchedule(POLL_DEFAULTS, options)),
    maxOutputBytes: options.maxOutputBytes,
  });
}
