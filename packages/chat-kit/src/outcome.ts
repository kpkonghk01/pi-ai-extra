import type { Api, AssistantMessage, AssistantMessageEvent, StopReason } from "@earendil-works/pi-ai";
import { withCost } from "./cost.ts";
import { errorText, statusFromMessage, TurnFailure } from "./errors.ts";
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

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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
    return { type: "error", reason: "aborted", error: withRecord({ ...message, stopReason: "aborted" }, usage) as ChatAssistantMessage };
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

/** `message` as a failed turn: `stopReason: "error"`, `[provider/model]` in front of the text, and the error's code. */
function failure(
  target: TurnTarget,
  message: AssistantMessage,
  code: ChatTurnErrorCode,
  text: string,
  extra: { usage?: ChatUsage | undefined; rawStopReason?: string | undefined; status?: number | undefined },
): ChatFinalEvent {
  const failed: AssistantMessage = {
    ...message,
    stopReason: "error",
    errorMessage: `[${target.provider}/${target.model}] ${text}`,
    ...(extra.rawStopReason === undefined ? {} : { rawStopReason: extra.rawStopReason }),
  };
  const error = { code, ...(extra.status === undefined ? {} : { status: extra.status }) };
  const record = { ...(extra.usage === undefined ? {} : { usage: extra.usage }), error };
  return { type: "error", reason: "error", error: { ...failed, chatKit: record } as ChatAssistantMessage };
}

function withRecord(message: AssistantMessage, usage: ChatUsage | undefined): AssistantMessage & { chatKit: { usage?: ChatUsage } } {
  return { ...message, chatKit: usage === undefined ? {} : { usage } };
}

/**
 * The lone `error` event of a turn the kit fails before sending anything, with no `start`, as
 * pi-ai's `lazyStream` ends a setup failure. `api` is the model's when it resolved, else `unknown`.
 */
export function failedBeforeSend(target: TurnTarget, code: ChatTurnErrorCode, text: string, api: Api = "unknown"): ChatFinalEvent {
  const message: ChatAssistantMessage = {
    role: "assistant",
    content: [],
    api,
    provider: target.provider,
    model: target.model,
    usage: ZERO_USAGE,
    stopReason: "error",
    errorMessage: `[${target.provider}/${target.model}] ${text}`,
    timestamp: Date.now(),
    chatKit: { error: { code } },
  };
  return { type: "error", reason: "error", error: message };
}

/** A failure thrown before or around the stream: the kit's own code, else aborted or a provider error. */
export function failedFrom(target: TurnTarget, error: unknown, signal: AbortSignal): ChatFinalEvent {
  if (error instanceof TurnFailure) return failedBeforeSend(target, error.code, error.message);
  if (signal.aborted) return abortedBeforeSend(target);
  return failedBeforeSend(target, "PROVIDER_ERROR", errorText(error));
}

/** The turn was aborted before anything was sent: pi-ai's `aborted`, without an error. */
export function abortedBeforeSend(target: TurnTarget): ChatFinalEvent {
  const message: ChatAssistantMessage = {
    role: "assistant",
    content: [],
    api: "unknown",
    provider: target.provider,
    model: target.model,
    usage: ZERO_USAGE,
    stopReason: "aborted",
    errorMessage: `[${target.provider}/${target.model}] The turn was aborted.`,
    timestamp: Date.now(),
    chatKit: {},
  };
  return { type: "error", reason: "aborted", error: message };
}
