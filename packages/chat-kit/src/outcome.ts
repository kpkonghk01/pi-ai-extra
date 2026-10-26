import type { AssistantMessage, AssistantMessageEvent, StopReason } from "@earendil-works/pi-ai";
import { zeroUsage } from "@hk01/pi-ai-extra-internal/pi-ai";
import { withCost } from "./cost.ts";
import { errorText, isTurnFailure, statusFromMessage, TurnFailure } from "./errors.ts";
import type { PreparedTurn, TurnTarget } from "./prepare.ts";
import type { ChatAssistantMessage, ChatTurnErrorCode, ChatUsage } from "./types.ts";
import type { StreamObserver } from "./wire/index.ts";

/** What the kit learned while the request ran, outside pi-ai's own events. */
export interface TurnState {
  /** A payload transform failed: nothing was sent. */
  transformFailure: TurnFailure | undefined;
  /** HTTP status of the latest provider response, when it was an error. */
  httpStatus: number | undefined;
}

/** One sent turn: what its final pi-ai event is classified with. */
export interface TurnRun {
  turn: PreparedTurn;
  observer: StreamObserver;
  state: TurnState;
  signal: AbortSignal;
}

/** pi-ai's last event of a stream: the finished message, or the failed one. */
export type FinalStreamEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

/** The final event of a turn, with the chat kit's record on its message. */
export type ChatFinalEvent =
  | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">; message: ChatAssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: ChatAssistantMessage };

/**
 * Classifies pi-ai's final event into the turn's final event: done, aborted, or an error with
 * the most specific code. `message.usage` stays pi-ai's; the provider's own counts and the cost
 * are in `chatKit.usage`.
 */
export function classifyOutcome(run: TurnRun, final: FinalStreamEvent, content: AssistantMessage["content"]): ChatFinalEvent {
  const { turn, observer, state } = run;
  // Read from the provider's raw usage, not pi-ai's `message.usage`, which reports an unreported count as zero.
  const usage = withCost(observer.usage(), turn.pricing);
  const message: AssistantMessage = { ...(final.type === "done" ? final.message : final.error), content };
  if (state.transformFailure) return failure(turn.target, message, state.transformFailure.code, state.transformFailure.message, { usage });
  if (final.type === "error" && (message.stopReason === "aborted" || run.signal.aborted)) {
    const aborted = { ...message, stopReason: "aborted" as const, errorMessage: prefixed(turn.target, ABORTED_TEXT) };
    return { type: "error", reason: "aborted", error: withRecord(aborted, usage) as ChatAssistantMessage };
  }
  const blocked = observer.blocked(message);
  if (blocked) return failure(turn.target, message, "CONTENT_BLOCKED", blocked.message, { usage, rawStopReason: blocked.reason });
  return final.type === "done" ? stoppedOutcome(turn, message, usage) : providerErrorOutcome(run, message, usage);
}

/** A stream that finished: an answer, an answer cut off at the limit, or an early stop. */
function stoppedOutcome(turn: PreparedTurn, message: AssistantMessage, usage: ChatUsage | undefined): ChatFinalEvent {
  const { schemaAsToolCall } = turn;
  const answered = schemaAsToolCall
    ? message.stopReason === "toolUse" && message.content.some((block) => block.type === "text")
    : message.stopReason === "stop" || message.stopReason === "toolUse";
  if (answered) {
    const stopReason = schemaAsToolCall ? "stop" : (message.stopReason as "stop" | "toolUse");
    return { type: "done", reason: stopReason, message: withRecord({ ...message, stopReason }, usage) as ChatAssistantMessage };
  }
  const rawStopReason = message.rawStopReason ?? message.stopReason;
  if (message.stopReason === "length") {
    // A free-form answer cut off at the output-token limit is still an answer. A cut-off
    // response-schema answer cannot be parsed, so that turn fails.
    if (turn.plan.responseSchema === undefined) {
      return { type: "done", reason: "length", message: withRecord(message, usage) as ChatAssistantMessage };
    }
    return failure(turn.target, message, "PROVIDER_ERROR", "The answer hit the output-token limit, so its response-schema JSON is incomplete.", {
      usage,
      rawStopReason,
    });
  }
  const text = schemaAsToolCall
    ? "The model answered without the response-schema tool call."
    : `The provider stopped with ${message.stopReason}.`;
  return failure(turn.target, message, "PROVIDER_ERROR", text, { usage, rawStopReason });
}

function providerErrorOutcome(run: TurnRun, message: AssistantMessage, usage: ChatUsage | undefined): ChatFinalEvent {
  const errorMessage = message.errorMessage ?? "The provider request failed.";
  return failure(run.turn.target, message, "PROVIDER_ERROR", errorMessage, {
    usage,
    rawStopReason: message.rawStopReason,
    status: run.state.httpStatus ?? statusFromMessage(errorMessage),
  });
}

const ABORTED_TEXT = "The turn was aborted.";

/** `text` with the turn's `[provider/model]` in front, as the reference named them. */
function prefixed(target: TurnTarget, text: string): string {
  return `[${target.provider}/${target.model}] ${text}`;
}

/** `message` as a failed turn: `stopReason: "error"`, `[provider/model]` in front of the text, and the error's code. */
function failure(
  target: TurnTarget,
  message: AssistantMessage,
  code: ChatTurnErrorCode,
  text: string,
  extra: { usage?: ChatUsage | undefined; rawStopReason?: string | undefined; status?: number | undefined },
): ChatFinalEvent {
  const error = { code, ...(extra.status === undefined ? {} : { status: extra.status }) };
  return {
    type: "error",
    reason: "error",
    error: {
      ...message,
      stopReason: "error",
      errorMessage: prefixed(target, text),
      ...(extra.rawStopReason === undefined ? {} : { rawStopReason: extra.rawStopReason }),
      chatKit: { ...(extra.usage === undefined ? {} : { usage: extra.usage }), error },
    },
  };
}

function withRecord(message: AssistantMessage, usage: ChatUsage | undefined): AssistantMessage & { chatKit: { usage?: ChatUsage } } {
  return { ...message, chatKit: usage === undefined ? {} : { usage } };
}

/**
 * The base of a message the kit ends itself, when pi-ai produced none: no content, a fresh zero
 * usage, and no `start` before it, as pi-ai's `lazyStream` ends a setup failure. `api` is the
 * model's when it had resolved (`TurnTarget.api`), else `unknown`; `provider` and `model` come from
 * the reference.
 */
function kitMessageBase(target: TurnTarget, text: string): Omit<AssistantMessage, "stopReason"> {
  return {
    role: "assistant",
    content: [],
    api: target.api ?? "unknown",
    provider: target.provider,
    model: target.model,
    usage: zeroUsage(),
    errorMessage: prefixed(target, text),
    timestamp: Date.now(),
  };
}

/**
 * A turn the kit ends itself with an error, with no result of pi-ai's: it failed before anything was
 * sent, or the provider's stream ended without a final event.
 */
export function kitFailed(target: TurnTarget, code: ChatTurnErrorCode, text: string): ChatFinalEvent {
  return { type: "error", reason: "error", error: { ...kitMessageBase(target, text), stopReason: "error", chatKit: { error: { code } } } };
}

/** A turn the kit ends itself because its signal aborted, with no result of pi-ai's: pi-ai's `aborted`, without an error. */
export function kitAborted(target: TurnTarget): ChatFinalEvent {
  return { type: "error", reason: "aborted", error: { ...kitMessageBase(target, ABORTED_TEXT), stopReason: "aborted", chatKit: {} } };
}

/** A failure thrown before or around the stream: the kit's own code, else aborted or a provider error. */
export function failedFrom(target: TurnTarget, error: unknown, signal: AbortSignal): ChatFinalEvent {
  if (isTurnFailure(error)) return kitFailed(target, error.code, error.message);
  if (signal.aborted) return kitAborted(target);
  return kitFailed(target, "PROVIDER_ERROR", errorText(error));
}
