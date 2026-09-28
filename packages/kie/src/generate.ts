import { z } from "zod";
import {
  assertApiKey,
  assertSupportedModel,
  completeResult,
  createOperationContext,
  DEFAULT_MAX_OUTPUT_BYTES,
  downloadResultImages,
  emitProgress,
  parseRequest,
  resolveReferenceImages,
  splitHelperOptions,
  throwIfAborted,
  uploadInlineReferences,
  type ImageGenerationResult,
  type ImageHelperOptions,
} from "@hk01/pi-ai-extra-internal";
import { createKieTask, uploadToKie, waitForKieTask, type KieEndpoints } from "./client.ts";
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

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const settingsSchema = z.strictObject({
  apiBaseUrl: z.url({ protocol: /^https?$/ }).optional(),
  uploadBaseUrl: z.url({ protocol: /^https?$/ }).optional(),
  poll: z
    .strictObject({ initialDelayMs: z.number().int().positive().optional(), maxDelayMs: z.number().int().positive().optional() })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
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
  const options = parseRequest(ctx, settingsSchema, {
    apiBaseUrl,
    uploadBaseUrl,
    poll,
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
  });
  const definition = kieModelDefinition(request.model as KieImageModelId);
  const parsed = parseRequest(ctx, definition.schema, modelPayload);
  const references = resolveReferenceImages(ctx, parsed.referenceImages, definition.info.referenceImages);
  emitProgress(ctx, { type: "validated", referenceImageCount: references.length });

  const endpoints: KieEndpoints = {
    apiBaseUrl: withoutTrailingSlash(options.apiBaseUrl ?? KIE_API_BASE_URL),
    uploadBaseUrl: withoutTrailingSlash(options.uploadBaseUrl ?? KIE_UPLOAD_BASE_URL),
  };
  const apiKey = request.apiKey;
  const imageUrls = await uploadInlineReferences(ctx, references, (reference) => uploadToKie(ctx, apiKey, endpoints, reference));

  throwIfAborted(ctx, "submit");
  const taskId = await createKieTask(ctx, apiKey, endpoints, parsed.model, definition.buildInput(parsed, imageUrls));
  emitProgress(ctx, { type: "task_submitted", taskId });

  const initialDelayMs = options.poll?.initialDelayMs ?? 2_500;
  const resultUrls = await waitForKieTask(ctx, apiKey, endpoints, taskId, {
    initialDelayMs,
    maxDelayMs: Math.max(initialDelayMs, options.poll?.maxDelayMs ?? 10_000),
    factor: 1.5,
    jitterRatio: 0.1,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const images = await downloadResultImages(ctx, resultUrls, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    retry: { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 5_000 },
    taskId,
  });
  return completeResult(ctx, taskId, images);
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
