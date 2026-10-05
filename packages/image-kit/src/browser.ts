import type { ImageErrorDetails, ImageModelView } from './models.ts';

/**
 * Browser side: reads the server's NDJSON image responses and collects errors for the
 * ErrorPanel (`/react`).
 */

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

/** The `complete` line's payload: the image plus any extra fields the route returned. */
export type ImageResponse = { imageUrl: string } & Record<string, unknown>;

interface StreamEvent {
  type?: unknown;
  imageUrl?: unknown;
  error?: unknown;
  details?: ImageErrorDetails;
}

/** Handles one NDJSON line: returns the payload for `complete`, throws for `error`, ignores start/ping. */
function handleLine(line: string, ignored: string[]): ImageResponse | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed) as StreamEvent;
  } catch {
    // Not one of the server's JSON lines (for example proxy padding); reported if no result follows.
    ignored.push(trimmed.slice(0, 200));
    return undefined;
  }
  if (event.type === 'error') {
    throw new ImageRequestError(typeof event.error === 'string' && event.error ? event.error : '生成失敗', event.details ?? {});
  }
  if (event.type !== 'complete') return undefined;
  if (typeof event.imageUrl !== 'string' || !event.imageUrl) throw new ImageRequestError('伺服器沒有返回圖片。', { code: 'no_output' });
  const { type: _type, ...payload } = event;
  return payload as ImageResponse;
}

/**
 * POSTs an image request and reads the server's NDJSON stream (start, ping…, complete | error).
 * One attempt only: billed requests are never re-sent. Aborting `signal` closes the stream, so
 * the server stops polling the provider; the abort error is rethrown as is so callers can treat
 * it as a cancellation.
 */
export async function postImageRequest(url: string, payload: unknown, signal?: AbortSignal): Promise<ImageResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ImageRequestError(`無法連線到伺服器：${error instanceof Error ? error.message : String(error)}`, { code: 'network' });
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: unknown; details?: ImageErrorDetails };
    const message = typeof data.error === 'string' && data.error ? data.error : `伺服器回應 ${response.status} ${response.statusText}`;
    throw new ImageRequestError(message, data.details ?? {}, response.status);
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
      const result = handleLine(line, ignored);
      if (result) {
        reader.cancel().catch(() => undefined);
        return result;
      }
    }
    if (done) break;
  }
  const last = handleLine(buffer, ignored);
  if (last) return last;
  const extra = ignored.length > 0 ? `（收到 ${ignored.length} 行無法解析的內容，例如：${ignored[0]}）` : '';
  throw new ImageRequestError(`連線在完成前中斷，沒有收到結果${extra}。`, { code: 'stream_ended' });
}

/** Whether `error` is the cancellation of `signal` (not a failure to report). */
export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

export async function fetchImageModels(url: string = '/api/image-models'): Promise<ImageModelView[]> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new ImageRequestError(`無法載入圖片模型清單：${error instanceof Error ? error.message : String(error)}`, { code: 'network' });
  }
  if (!response.ok) throw new ImageRequestError(`無法載入圖片模型清單（HTTP ${response.status}）。`, { code: 'models_unavailable' }, response.status);
  const data: unknown = await response.json().catch(() => null);
  const models = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) throw new ImageRequestError('圖片模型清單格式不正確。', { code: 'invalid_response' });
  return models as ImageModelView[];
}

export interface ErrorEntry {
  id: number;
  at: string;
  /** What the user was doing, for example "圖卡生成". */
  operation: string;
  message: string;
  details: ImageErrorDetails;
  httpStatus: number | undefined;
  /** Extra facts such as "第 2/5 張". */
  context: Readonly<Record<string, string>>;
}

type Listener = (entry: ErrorEntry) => void;
const listeners = new Set<Listener>();
let nextId = 1;
/** Latest error, replayed to a panel that mounts after it was reported. */
let latest: ErrorEntry | null = null;

/** Sends an error to the ErrorPanel. Any component can call it; the panel shows the latest one. */
export function reportError(error: unknown, operation: string, context: Record<string, string | number | undefined> = {}): ErrorEntry {
  const entry: ErrorEntry = {
    id: nextId++,
    at: new Date().toISOString(),
    operation,
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof ImageRequestError ? error.details : {},
    httpStatus: error instanceof ImageRequestError ? error.httpStatus : undefined,
    context: Object.fromEntries(Object.entries(context).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]]))),
  };
  latest = entry;
  listeners.forEach((listener) => listener(entry));
  return entry;
}

export function subscribeErrors(listener: Listener): () => void {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
  };
}

/** Plain-text report for bug reports: everything the panel shows, one fact per line. */
export function formatErrorReport(entry: ErrorEntry): string {
  const { details } = entry;
  const lines = [
    `操作: ${entry.operation}`,
    `時間: ${entry.at}`,
    details.appModelId ? `App model: ${details.appModelId}` : '',
    details.provider || details.model ? `Provider/model: ${details.provider ?? '-'}/${details.model ?? '-'}` : '',
    details.code ? `Error code: ${details.code}` : '',
    details.status !== undefined ? `Provider HTTP status: ${details.status}` : '',
    entry.httpStatus !== undefined ? `App HTTP status: ${entry.httpStatus}` : '',
    details.providerCode ? `Provider code: ${details.providerCode}` : '',
    details.taskId ? `Task id: ${details.taskId}` : '',
    ...Object.entries(entry.context).map(([key, value]) => `${key}: ${value}`),
    `訊息: ${entry.message}`,
    `頁面: ${typeof location === 'undefined' ? '-' : location.href}`,
  ];
  return lines.filter(Boolean).join('\n');
}
