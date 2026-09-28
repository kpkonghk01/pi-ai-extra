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
import { createToapisTask, uploadToToapis } from "./client.ts";
import { TOAPIS_BASE_URL, TOAPIS_PROVIDER_ID } from "./constants.ts";
import {
  TOAPIS_IMAGE_MODEL_IDS,
  toapisModelDefinition,
  type ToapisGeminiAspectRatio,
  type ToapisGptImage25AspectRatio,
  type ToapisGptImage2AspectRatio,
  type ToapisImageModelId,
  type ToapisResolution,
  type ToapisSeedreamAspectRatio,
  type ToapisSeedreamResolution,
} from "./models.ts";
import { waitForToapisTask } from "./task.ts";

/** Advanced transport settings. Defaults follow ToAPIs' documentation. */
export interface ToapisImageSettings {
  /** Host for uploads and image tasks. Default `https://toapis.com`; mainland China users may set `https://toapis.cn`. */
  baseUrl?: string | undefined;
  /** Status polling cadence. Default: 5 s, growing 1.5x up to 10 s, with jitter. */
  poll?: { initialDelayMs?: number | undefined; maxDelayMs?: number | undefined } | undefined;
  /**
   * Caller-side business id sent as top-level `client_business_id` (for example
   * `open-graph-single:req-123`), so ToAPIs records can be attributed to an app or request.
   * The task can also be looked up by it. Non-empty, at most 128 characters, no control
   * characters or surrounding whitespace. Use a unique value per request.
   */
  clientBusinessId?: string | undefined;
}

interface ToapisRequestBase extends ImageHelperOptions, ToapisImageSettings {
  prompt: string;
  /**
   * Data URLs (uploaded through ToAPIs `/v1/uploads/images`) or public http(s) URLs (passed through).
   * The count must be within the model's documented limit; nothing is dropped.
   */
  referenceImages?: readonly string[] | undefined;
}

export interface ToapisGeminiFlashImageRequest extends ToapisRequestBase {
  model: "gemini-3.1-flash-image-preview";
  aspectRatio?: ToapisGeminiAspectRatio | undefined;
  resolution?: ToapisResolution | undefined;
}

export interface ToapisGptImage2Request extends ToapisRequestBase {
  model: "gpt-image-2";
  aspectRatio?: ToapisGptImage2AspectRatio | undefined;
  resolution?: ToapisResolution | undefined;
  /** Set `transparent` for a transparent background; omit for a normal image. */
  background?: "transparent" | undefined;
}

export interface ToapisGptImage25Request extends ToapisRequestBase {
  model: "gpt-image-2.5-flare" | "gpt-image-2.5-sunburst";
  aspectRatio?: ToapisGptImage25AspectRatio | undefined;
  resolution?: ToapisResolution | undefined;
  background?: "transparent" | undefined;
}

export interface ToapisSeedreamRequest extends ToapisRequestBase {
  model: "doubao-seedream-5-0-pro";
  aspectRatio?: ToapisSeedreamAspectRatio | undefined;
  resolution?: ToapisSeedreamResolution | undefined;
  /** Default false. */
  watermark?: boolean | undefined;
}

export type ToapisImageRequest = ToapisGeminiFlashImageRequest | ToapisGptImage2Request | ToapisGptImage25Request | ToapisSeedreamRequest;

/** ToAPIs recommends waiting at least 5-10 s with jitter between status queries. */
const POLL_DEFAULTS: PollDefaults = { initialDelayMs: 5_000, maxDelayMs: 10_000, factor: 1.5, jitterRatio: 0.2, timeoutMs: 6 * 60_000 };

export const CLIENT_BUSINESS_ID_MAX_LENGTH = 128;

const clientBusinessIdSchema = z
  .string()
  .min(1, "clientBusinessId must not be empty")
  .max(CLIENT_BUSINESS_ID_MAX_LENGTH, `clientBusinessId must be at most ${CLIENT_BUSINESS_ID_MAX_LENGTH} characters`)
  .refine((value) => value === value.trim(), "clientBusinessId must not start or end with whitespace")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "clientBusinessId must not contain control characters");

const settingsSchema = z.strictObject({
  ...taskSettingsShape,
  baseUrl: httpUrlSchema.optional(),
  clientBusinessId: clientBusinessIdSchema.optional(),
});

/**
 * Generates or edits an image with one ToAPIs model: validates the request, uploads
 * inline references through ToAPIs only, creates the task, polls the same task until
 * completed/failed/timeout/cancellation, downloads the result and returns data URLs.
 */
export async function generateToapisImage(request: ToapisImageRequest): Promise<ImageGenerationResult> {
  const ctx = createOperationContext({
    provider: TOAPIS_PROVIDER_ID,
    model: String(request.model),
    signal: request.signal,
    fetch: request.fetch,
    onProgress: request.onProgress,
  });
  assertSupportedModel(ctx, request.model, TOAPIS_IMAGE_MODEL_IDS);
  assertApiKey(ctx, request.apiKey);

  const { settings, payload } = splitHelperOptions(request);
  const { baseUrl, poll, clientBusinessId, ...modelPayload } = payload;
  const options = parseRequest(ctx, settingsSchema, { baseUrl, poll, clientBusinessId, timeoutMs: settings.timeoutMs, maxOutputBytes: settings.maxOutputBytes });
  const definition = toapisModelDefinition(request.model as ToapisImageModelId);
  const parsed = parseRequest(ctx, definition.schema, modelPayload);
  const references = resolveReferenceImages(ctx, parsed.referenceImages, definition.info.referenceImages);
  emitProgress(ctx, { type: "validated", referenceImageCount: references.length });

  const apiKey = request.apiKey;
  const host = withoutTrailingSlash(options.baseUrl ?? TOAPIS_BASE_URL);
  const attribution = options.clientBusinessId === undefined ? {} : { client_business_id: options.clientBusinessId };
  return runAsyncImageTask(ctx, {
    references,
    upload: (reference) => uploadToToapis(ctx, apiKey, host, reference),
    submit: (imageUrls) => createToapisTask(ctx, apiKey, host, { ...definition.buildBody(parsed, imageUrls), ...attribution }),
    wait: (taskId) => waitForToapisTask(ctx, apiKey, host, taskId, pollSchedule(POLL_DEFAULTS, options)),
    maxOutputBytes: options.maxOutputBytes,
  });
}
