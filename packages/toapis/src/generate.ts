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
   * The task can also be looked up by it. 1-128 characters of `A-Z a-z 0-9 . _ : -`.
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

const DEFAULT_TIMEOUT_MS = 6 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export const CLIENT_BUSINESS_ID_PATTERN: RegExp = /^[A-Za-z0-9._:-]{1,128}$/;

const settingsSchema = z.strictObject({
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
  clientBusinessId: z
    .string()
    .regex(CLIENT_BUSINESS_ID_PATTERN, "clientBusinessId must be 1-128 characters of A-Z a-z 0-9 . _ : -")
    .optional(),
  poll: z
    .strictObject({ initialDelayMs: z.number().int().positive().optional(), maxDelayMs: z.number().int().positive().optional() })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
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
  const options = parseRequest(ctx, settingsSchema, {
    baseUrl,
    poll,
    clientBusinessId,
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
  });
  const definition = toapisModelDefinition(request.model as ToapisImageModelId);
  const parsed = parseRequest(ctx, definition.schema, modelPayload);
  const references = resolveReferenceImages(ctx, parsed.referenceImages, definition.info.referenceImages);
  emitProgress(ctx, { type: "validated", referenceImageCount: references.length });

  const host = (options.baseUrl ?? TOAPIS_BASE_URL).replace(/\/+$/, "");
  const apiKey = request.apiKey;
  const imageUrls = await uploadInlineReferences(ctx, references, (reference) => uploadToToapis(ctx, apiKey, host, reference));

  throwIfAborted(ctx, "submit");
  const body = {
    ...definition.buildBody(parsed, imageUrls),
    ...(options.clientBusinessId === undefined ? {} : { client_business_id: options.clientBusinessId }),
  };
  const taskId = await createToapisTask(ctx, apiKey, host, body);
  emitProgress(ctx, { type: "task_submitted", taskId });

  const initialDelayMs = options.poll?.initialDelayMs ?? 5_000;
  const { resultUrls, usage } = await waitForToapisTask(ctx, apiKey, host, taskId, {
    initialDelayMs,
    maxDelayMs: Math.max(initialDelayMs, options.poll?.maxDelayMs ?? 10_000),
    factor: 1.5,
    jitterRatio: 0.2,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const images = await downloadResultImages(ctx, resultUrls, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    retry: { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 5_000 },
    taskId,
  });
  return completeResult(ctx, taskId, images, usage);
}
