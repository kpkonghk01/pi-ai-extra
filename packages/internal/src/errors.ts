/**
 * Every failure a pi-ai-extra helper reports is a `PiAiExtraError`. It always
 * names the selected provider and model so operators know which console, key,
 * quota or task record to inspect. Nothing in these packages retries through
 * another provider or model after one of these errors.
 */
export type PiAiExtraErrorCode =
  | "invalid_request"
  | "reference_limit"
  | "invalid_reference"
  | "auth"
  | "insufficient_credits"
  | "rate_limited"
  | "http"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "upload_failed"
  | "task_failed"
  | "content_blocked"
  | "no_output"
  | "invalid_output";

export type PiAiExtraOperation = "validate" | "upload" | "submit" | "poll" | "generate" | "download";

export interface PiAiExtraErrorDetails {
  provider: string;
  model: string;
  code: PiAiExtraErrorCode;
  operation?: PiAiExtraOperation | undefined;
  /** HTTP status of the provider response, when there was one. */
  status?: number | undefined;
  /** Provider task id, once a task has been created. */
  taskId?: string | undefined;
  /** Provider-native error/fail code, when the provider returned one. */
  providerCode?: string | undefined;
  /** Whether repeating the same request to the same provider/model may succeed. */
  retryable?: boolean | undefined;
  /** Truncated provider response body for diagnostics. Never contains request credentials. */
  responseBody?: string | undefined;
  cause?: unknown;
}

export interface SerializedPiAiExtraError {
  name: "PiAiExtraError";
  message: string;
  provider: string;
  model: string;
  code: PiAiExtraErrorCode;
  operation: PiAiExtraOperation | undefined;
  status: number | undefined;
  taskId: string | undefined;
  providerCode: string | undefined;
  retryable: boolean;
  responseBody: string | undefined;
  cause: string | undefined;
}

export class PiAiExtraError extends Error {
  /** Brand checked by `isPiAiExtraError`, which also works across bundled copies and CJS/ESM builds. */
  readonly isPiAiExtraError: true;
  readonly provider: string;
  readonly model: string;
  readonly code: PiAiExtraErrorCode;
  readonly operation: PiAiExtraOperation | undefined;
  readonly status: number | undefined;
  readonly taskId: string | undefined;
  readonly providerCode: string | undefined;
  readonly retryable: boolean;
  readonly responseBody: string | undefined;

  constructor(message: string, details: PiAiExtraErrorDetails) {
    super(`[${details.provider}/${details.model}] ${message}`, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "PiAiExtraError";
    this.isPiAiExtraError = true;
    this.provider = details.provider;
    this.model = details.model;
    this.code = details.code;
    this.operation = details.operation;
    this.status = details.status;
    this.taskId = details.taskId;
    this.providerCode = details.providerCode;
    this.retryable = details.retryable ?? false;
    this.responseBody = details.responseBody;
  }

  toJSON(): SerializedPiAiExtraError {
    return {
      name: "PiAiExtraError",
      message: this.message,
      provider: this.provider,
      model: this.model,
      code: this.code,
      operation: this.operation,
      status: this.status,
      taskId: this.taskId,
      providerCode: this.providerCode,
      retryable: this.retryable,
      responseBody: this.responseBody,
      cause: describeCause(this.cause),
    };
  }
}

const CONTENT_BLOCK_PATTERN = /safety|moderation|content[\s_-]?policy|violat|prohibited|sensitive|nsfw|blocked/i;

/** Whether a provider failure message/code indicates a safety or policy block (reported as `content_blocked`). */
export function looksLikeContentBlock(...texts: readonly (string | undefined)[]): boolean {
  return texts.some((text) => text !== undefined && CONTENT_BLOCK_PATTERN.test(text));
}

export function isPiAiExtraError(value: unknown): value is PiAiExtraError {
  return value instanceof Error && (value as { isPiAiExtraError?: unknown }).isPiAiExtraError === true;
}

/** Copy of an existing error with extra context (for example the task id learned after submission). */
export function withErrorContext(error: PiAiExtraError, extra: Partial<PiAiExtraErrorDetails>): PiAiExtraError {
  const prefix = `[${error.provider}/${error.model}] `;
  const message = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  return new PiAiExtraError(message, {
    provider: error.provider,
    model: error.model,
    code: error.code,
    operation: error.operation,
    status: error.status,
    taskId: error.taskId,
    providerCode: error.providerCode,
    retryable: error.retryable,
    responseBody: error.responseBody,
    cause: error.cause,
    ...extra,
  });
}

function describeCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}
