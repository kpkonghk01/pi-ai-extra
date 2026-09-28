import { elapsedMs, emitProgress, type FetchLike, type ImageProgressListener, type OperationContext } from "./context.ts";
import { encodeBase64, toDataUrl, type ImageBytes, type ImageMimeType } from "./image-data.ts";
import type { ImageUsage } from "./usage.ts";
import { omitUndefined } from "./util.ts";

/** Options shared by every high-level image helper. */
export interface ImageHelperOptions {
  /** Provider API key from server-side secret configuration. Never read from environment variables. */
  apiKey: string;
  signal?: AbortSignal | undefined;
  /** Overall deadline for the provider task (or synchronous generation), in milliseconds. */
  timeoutMs?: number | undefined;
  /** Largest accepted result image in bytes. Default 50 MiB. */
  maxOutputBytes?: number | undefined;
  onProgress?: ImageProgressListener | undefined;
  /** Custom fetch (tests, proxies, instrumentation). Defaults to global `fetch`. */
  fetch?: FetchLike | undefined;
}

export interface GeneratedImage {
  /** `data:<mime>;base64,<data>` */
  dataUrl: string;
  mimeType: ImageMimeType;
  byteLength: number;
  /** Provider result URL the image was downloaded from (temporary). Undefined for inline results. */
  sourceUrl: string | undefined;
}

export interface ImageGenerationResult {
  provider: string;
  model: string;
  /** Provider task id (KIE, ToAPIs) or response id (Gemini `responseId`); use it to reconcile usage. */
  taskId: string | undefined;
  images: GeneratedImage[];
  elapsedMs: number;
  /**
   * Usage/billing the provider reported for this task or request, Zod-validated and
   * never estimated. Undefined when the provider reported nothing. For ToAPIs the
   * billing may still be `pending`; re-query by task id before recording spend.
   */
  usage: ImageUsage | undefined;
}

export const DEFAULT_MAX_OUTPUT_BYTES: number = 50 * 1024 * 1024;

export function toGeneratedImage(image: ImageBytes & { sourceUrl?: string | undefined }): GeneratedImage {
  return {
    dataUrl: toDataUrl(image.mimeType, encodeBase64(image.bytes)),
    mimeType: image.mimeType,
    byteLength: image.bytes.byteLength,
    sourceUrl: image.sourceUrl,
  };
}

export function completeResult(
  ctx: OperationContext,
  taskId: string | undefined,
  images: readonly (ImageBytes & { sourceUrl?: string | undefined })[],
  usage: ImageUsage | undefined,
): ImageGenerationResult {
  const result: ImageGenerationResult = {
    provider: ctx.provider,
    model: ctx.model,
    taskId,
    images: images.map(toGeneratedImage),
    elapsedMs: elapsedMs(ctx),
    usage,
  };
  emitProgress(ctx, { type: "completed", imageCount: result.images.length, elapsedMs: result.elapsedMs });
  return result;
}

/**
 * Splits helper options into transport settings and the model payload that the schema
 * validates. Keys whose value is `undefined` mean "not set" and are dropped, so callers
 * can pass optional fields unconditionally; misspelled keys with a value are still rejected.
 */
export function splitHelperOptions<T extends ImageHelperOptions>(
  options: T,
): { settings: ImageHelperOptions; payload: Record<string, unknown> } {
  const { apiKey, signal, timeoutMs, maxOutputBytes, onProgress, fetch, ...payload } = options;
  return { settings: { apiKey, signal, timeoutMs, maxOutputBytes, onProgress, fetch }, payload: omitUndefined(payload) };
}
