import { PiAiExtraError, type PiAiExtraErrorDetails } from "./errors.ts";

/** Same call shape as global `fetch`, so pi-ai's `options.fetch` can be passed straight through. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Progress notifications for UIs and diagnostics. They never carry credentials. */
export type ImageProgressEvent =
  | { type: "validated"; provider: string; model: string; referenceImageCount: number }
  | { type: "upload_started"; provider: string; model: string; index: number; total: number }
  | { type: "upload_completed"; provider: string; model: string; index: number; total: number; url: string }
  | { type: "task_submitted"; provider: string; model: string; taskId: string }
  | { type: "task_status"; provider: string; model: string; taskId: string; status: string; elapsedMs: number }
  | { type: "request_sent"; provider: string; model: string }
  | { type: "download_started"; provider: string; model: string; index: number; total: number; url: string }
  | { type: "completed"; provider: string; model: string; imageCount: number; elapsedMs: number }
  /** Non-fatal problem, e.g. usage/billing data that failed validation and was therefore omitted. */
  | { type: "warning"; provider: string; model: string; message: string };

export type ImageProgressListener = (event: ImageProgressEvent) => void;

type ProgressPayload<T extends ImageProgressEvent = ImageProgressEvent> = T extends ImageProgressEvent
  ? Omit<T, "provider" | "model">
  : never;

/** Per-call state shared by transport, upload, polling and download helpers. */
export interface OperationContext {
  readonly provider: string;
  readonly model: string;
  readonly signal: AbortSignal | undefined;
  readonly fetch: FetchLike;
  readonly startedAt: number;
  readonly onProgress: ImageProgressListener | undefined;
}

export interface OperationContextInput {
  provider: string;
  model: string;
  signal?: AbortSignal | undefined;
  fetch?: FetchLike | undefined;
  onProgress?: ImageProgressListener | undefined;
}

export function createOperationContext(input: OperationContextInput): OperationContext {
  return {
    provider: input.provider,
    model: input.model,
    signal: input.signal,
    fetch: input.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    startedAt: Date.now(),
    onProgress: input.onProgress,
  };
}

export function contextError(
  ctx: OperationContext,
  message: string,
  details: Omit<PiAiExtraErrorDetails, "provider" | "model">,
): PiAiExtraError {
  return new PiAiExtraError(message, { provider: ctx.provider, model: ctx.model, ...details });
}

/**
 * Emits a progress event. A throwing listener is deliberately ignored: a logging
 * failure must not abandon an already-billed provider task.
 */
export function emitProgress(ctx: OperationContext, event: ProgressPayload): void {
  if (!ctx.onProgress) return;
  try {
    ctx.onProgress({ ...event, provider: ctx.provider, model: ctx.model } as ImageProgressEvent);
  } catch {
    // Intentionally ignored; see function documentation.
  }
}

export function elapsedMs(ctx: OperationContext): number {
  return Date.now() - ctx.startedAt;
}
