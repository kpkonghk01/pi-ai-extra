import type { ImageErrorDetails, ImageModelView } from '../shared/imageModels';

export type { ImageErrorDetails };

export class ImageRequestError extends Error {
  readonly details: ImageErrorDetails;
  /** HTTP status of the response, when the server rejected the request before streaming. */
  readonly httpStatus: number | undefined;
  constructor(message: string, details: ImageErrorDetails = {}, httpStatus?: number) {
    super(message);
    this.name = 'ImageRequestError';
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

interface StreamEvent {
  type?: string;
  rawImageBase64?: string;
  error?: string;
  details?: ImageErrorDetails;
}

/** Handles one NDJSON line; returns the image for `complete`, throws for `error`, ignores start/ping. */
function handleLine(line: string, ignored: string[]): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    // Not one of the server's JSON lines (for example proxy padding); reported if no result follows.
    ignored.push(trimmed.slice(0, 200));
    return undefined;
  }
  if (event.type === 'error') throw new ImageRequestError(event.error || '生成失敗', event.details ?? {});
  if (event.type !== 'complete') return undefined;
  if (!event.rawImageBase64) throw new ImageRequestError('伺服器沒有返回圖片。', { code: 'no_output' });
  return event.rawImageBase64;
}

/**
 * POSTs an image request and reads the server's NDJSON stream (start, ping…, complete | error).
 * Resolves with the raw image data URL. One attempt only: billed requests are never re-sent.
 * Aborting `signal` (the cancel buttons) closes the stream, so the server stops polling the provider;
 * the abort error is rethrown as is so callers can treat it as a cancellation.
 */
export async function postImageRequest(url: string, payload: unknown, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ImageRequestError(`無法連線到伺服器：${error instanceof Error ? error.message : String(error)}`, { code: 'network' });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ImageRequestError(data.error || `伺服器回應 ${response.status} ${response.statusText}`, data.details ?? {}, response.status);
  }
  if (!response.body) throw new ImageRequestError('伺服器沒有返回內容。', { code: 'invalid_response' });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const ignored: string[] = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const image = handleLine(line, ignored);
      if (image) {
        reader.cancel().catch(() => undefined);
        return image;
      }
    }
    if (done) break;
  }
  const last = handleLine(buffer, ignored);
  if (last) return last;
  const extra = ignored.length > 0 ? `（收到 ${ignored.length} 行無法解析的內容，例如：${ignored[0]}）` : '';
  throw new ImageRequestError(`連線在完成前中斷，沒有收到結果${extra}。`, { code: 'stream_ended' });
}

export async function fetchImageModels(): Promise<ImageModelView[]> {
  const response = await fetch('/api/image-models');
  if (!response.ok) throw new ImageRequestError(`無法載入圖片模型清單（HTTP ${response.status}）。`, { code: 'models_unavailable' }, response.status);
  const data: unknown = await response.json().catch(() => null);
  const models = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) throw new ImageRequestError('圖片模型清單格式不正確。', { code: 'invalid_response' });
  return models as ImageModelView[];
}
