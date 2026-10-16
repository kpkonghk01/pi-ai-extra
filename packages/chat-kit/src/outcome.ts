import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { errorText, statusFromMessage, TurnFailure } from "./errors.ts";
import type { PreparedTurn, TurnTarget } from "./prepare.ts";
import type { ChatTurnError, ChatTurnErrorCode, ChatTurnEvent, ChatUsage } from "./types.ts";
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

/** Classifies the final pi-ai event: done, or failed with the most specific code. */
export function classifyOutcome(run: TurnRun, final: FinalStreamEvent): ChatTurnEvent {
  const { turn, observer, state } = run;
  // Read from the provider's raw usage, not pi-ai's `message.usage`, which reports an unreported
  // count (or no usage at all) as zero. Usage goes on any final event only when it was reported.
  const usage = observer.usage();
  if (state.transformFailure) return failed(turn.target, state.transformFailure.code, state.transformFailure.message);
  const message = final.type === "done" ? final.message : final.error;
  if (final.type === "error" && (message.stopReason === "aborted" || run.signal.aborted)) {
    return failed(turn.target, "ABORTED", "The turn was aborted.", { usage });
  }
  const blocked = observer.blocked(message);
  if (blocked) return failed(turn.target, "CONTENT_BLOCKED", blocked.message, { reason: blocked.reason, usage });
  return final.type === "done" ? stoppedOutcome(turn, message, usage) : providerErrorOutcome(run, message, usage);
}

/** A stream that finished: an answer, a free-form answer cut off at the limit, or an early stop. */
function stoppedOutcome(turn: PreparedTurn, message: AssistantMessage, usage: ChatUsage | undefined): ChatTurnEvent {
  const answered = turn.schemaAsToolCall
    ? message.stopReason === "toolUse" && message.content.some((block) => block.type === "toolCall")
    : message.stopReason === "stop";
  if (answered) return done(usage);
  const reason = message.rawStopReason ?? message.stopReason;
  if (message.stopReason === "length") {
    // A free-form answer cut off at the output-token limit is still an answer: the text already
    // streamed stands, marked `truncated`. A cut-off response-schema answer (JSON text, or a forced
    // tool call's arguments on Anthropic Messages) cannot be parsed, so that turn fails.
    if (turn.plan.responseSchema === undefined) return done(usage, true);
    return failed(turn.target, "PROVIDER_ERROR", "The answer hit the output-token limit, so its response-schema JSON is incomplete.", {
      reason,
      usage,
    });
  }
  const text = turn.schemaAsToolCall
    ? "The model answered without the response-schema tool call."
    : `The provider stopped with ${message.stopReason}.`;
  return failed(turn.target, "PROVIDER_ERROR", text, { reason, usage });
}

function providerErrorOutcome(run: TurnRun, message: AssistantMessage, usage: ChatUsage | undefined): ChatTurnEvent {
  const errorMessage = message.errorMessage ?? "The provider request failed.";
  return failed(run.turn.target, "PROVIDER_ERROR", errorMessage, {
    reason: message.rawStopReason,
    status: run.state.httpStatus ?? statusFromMessage(errorMessage),
    usage,
  });
}

function done(usage: ChatUsage | undefined, truncated?: true): ChatTurnEvent {
  return {
    type: "done",
    ...(usage === undefined ? {} : { usage }),
    ...(truncated === undefined ? {} : { truncated }),
  };
}

export function failed(
  target: TurnTarget,
  code: ChatTurnErrorCode,
  message: string,
  extra: { reason?: string | undefined; status?: number | undefined; usage?: ChatUsage | undefined } = {},
): ChatTurnEvent {
  const error: ChatTurnError = {
    code,
    provider: target.provider,
    model: target.model,
    message: `[${target.provider}/${target.model}] ${message}`,
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.status === undefined ? {} : { status: extra.status }),
  };
  return extra.usage === undefined ? { type: "failed", error } : { type: "failed", error, usage: extra.usage };
}

/** A failure thrown before or around the stream: the kit's own code, else aborted or a provider error. */
export function failedFrom(target: TurnTarget, error: unknown, signal: AbortSignal): ChatTurnEvent {
  if (error instanceof TurnFailure) return failed(target, error.code, error.message);
  if (signal.aborted) return failed(target, "ABORTED", "The turn was aborted.");
  return failed(target, "PROVIDER_ERROR", errorText(error));
}
