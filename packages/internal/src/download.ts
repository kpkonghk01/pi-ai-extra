import { contextError, emitProgress, type OperationContext } from "./context.ts";
import { isPiAiExtraError } from "./errors.ts";
import { httpStatusError, openRequest, type HttpRequest } from "./http.ts";
import { withRetry, type RetryPolicy } from "./retry.ts";
import { formatBytes, sniffImageMimeType, type ImageBytes } from "./image-data.ts";

export interface DownloadOptions {
  timeoutMs: number;
  maxBytes: number;
  retry: RetryPolicy;
  taskId?: string | undefined;
}

export interface DownloadedImage extends ImageBytes {
  sourceUrl: string;
}

/** Downloads provider result URLs promptly (they are temporary), in order, validating each image. */
export async function downloadResultImages(
  ctx: OperationContext,
  urls: readonly string[],
  options: DownloadOptions,
): Promise<DownloadedImage[]> {
  const images: DownloadedImage[] = [];
  for (const [index, url] of urls.entries()) {
    emitProgress(ctx, { type: "download_started", index, total: urls.length, url });
    images.push(await downloadImage(ctx, url, options));
  }
  return images;
}

/** Downloads one image with a size cap. Retries only this same URL on transient failures. */
export async function downloadImage(ctx: OperationContext, url: string, options: DownloadOptions): Promise<DownloadedImage> {
  const request: HttpRequest = { url, method: "GET", operation: "download", taskId: options.taskId, timeoutMs: options.timeoutMs };
  return withRetry(ctx, options.retry, "download", options.taskId, () => downloadOnce(ctx, request, options.maxBytes));
}

async function downloadOnce(ctx: OperationContext, request: HttpRequest, maxBytes: number): Promise<DownloadedImage> {
  const { response, toError } = await openRequest(ctx, request);
  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (error) {
      throw toError(error);
    }
    throw httpStatusError(ctx, request, response, undefined, text);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(ctx, request, declaredLength, maxBytes);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readWithLimit(response, maxBytes, (received) => tooLarge(ctx, request, received, maxBytes));
  } catch (error) {
    throw isPiAiExtraError(error) ? error : toError(error);
  }

  const mimeType = sniffImageMimeType(bytes);
  if (!mimeType) {
    const contentType = response.headers.get("content-type") ?? "unknown";
    const preview = new TextDecoder().decode(bytes.subarray(0, 200));
    throw contextError(ctx, `Result ${request.url} is not a PNG, JPEG, WebP or GIF image (content-type: ${contentType}).`, {
      code: "invalid_output",
      operation: "download",
      taskId: request.taskId,
      status: response.status,
      responseBody: preview,
    });
  }
  return { mimeType, bytes, sourceUrl: request.url };
}

async function readWithLimit(response: Response, maxBytes: number, onTooLarge: (received: number) => Error): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw onTooLarge(received);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function tooLarge(ctx: OperationContext, request: HttpRequest, size: number, maxBytes: number) {
  return contextError(ctx, `Result image exceeds ${formatBytes(maxBytes)} (received at least ${formatBytes(size)}).`, {
    code: "invalid_output",
    operation: "download",
    taskId: request.taskId,
  });
}
