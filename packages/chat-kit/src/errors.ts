import type { ChatTurnErrorCode } from "./types.ts";

/**
 * A failure the kit detects itself (before or while building the request). It never escapes a
 * turn: it becomes the final `error` event, with this code. Thrown inside a payload transform, it
 * stops the request before anything is sent.
 */
export class TurnFailure extends Error {
  readonly code: ChatTurnErrorCode;
  constructor(code: ChatTurnErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TurnFailure";
    this.code = code;
  }
}

/**
 * Best-effort HTTP status from a pi-ai error message, for adapters where the kit cannot observe
 * the response itself (Gemini): `400 {...}` (OpenAI/Anthropic SDKs), `got status: 400`, or a
 * JSON error body's `"code": 400` (Gemini SDK).
 */
export function statusFromMessage(message: string | undefined): number | undefined {
  if (!message) return undefined;
  const match = /^(\d{3})\b/.exec(message) ?? /got status: (\d{3})\b/.exec(message) ?? /"code"\s*:\s*(\d{3})\b/.exec(message);
  const status = match ? Number(match[1]) : undefined;
  return status !== undefined && status >= 400 && status <= 599 ? status : undefined;
}

/**
 * `read()`, or `fallback` when it throws. For what the kit reads of a caller's objects or of a
 * thrown value, where a getter or proxy that throws must not end a turn with an exception.
 */
export function readOr<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The text of anything thrown, even a null-prototype object or an error whose `message` getter throws. */
export function errorText(error: unknown): string {
  return readOr(() => (error instanceof Error ? error.message : String(error)), "unknown error");
}

/** `error instanceof TurnFailure`, which a proxy with a throwing `getPrototypeOf` trap would make throw. */
export function isTurnFailure(error: unknown): error is TurnFailure {
  return readOr(() => error instanceof TurnFailure, false);
}
