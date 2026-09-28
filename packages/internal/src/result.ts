import { elapsedMs, emitProgress, type FetchLike, type ImageProgressListener, type OperationContext } from "./context.ts";
import { encodeBase64, toDataUrl, type ImageBytes, type ImageMimeType } from "./image-data.ts";

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
  /** Provider task id for asynchronous providers. */
  taskId: string | undefined;
  images: GeneratedImage[];
  elapsedMs: number;
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
): ImageGenerationResult {
  const result: ImageGenerationResult = {
    provider: ctx.provider,
    model: ctx.model,
    taskId,
    images: images.map(toGeneratedImage),
    elapsedMs: elapsedMs(ctx),
  };
  emitProgress(ctx, { type: "completed", imageCount: result.images.length, elapsedMs: result.elapsedMs });
  return result;
}

/** Splits helper options into transport settings and the model payload that the schema validates. */
export function splitHelperOptions<T extends ImageHelperOptions>(
  options: T,
): { settings: ImageHelperOptions; payload: Record<string, unknown> } {
  const { apiKey, signal, timeoutMs, maxOutputBytes, onProgress, fetch, ...payload } = options;
  return { settings: { apiKey, signal, timeoutMs, maxOutputBytes, onProgress, fetch }, payload };
}
