import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

type Content = AssistantMessage["content"];

/**
 * A response schema on Anthropic Messages is a forced call of one tool, whose arguments are the
 * answer. This turns pi-ai's events for that call into text events, so the consumer reads the
 * answer like any other:
 *
 * - the call's `toolcall_*` events become `text_*` events, and the call becomes a text block;
 * - free text the model wrote beside the call is dropped (it is not the answer), so every
 *   `contentIndex` and partial message is renumbered to match the final message;
 * - an empty call (no argument deltas) streams its arguments, `{}`, as one `text_delta`.
 *
 * One translator per turn (`forcedCallAnswer()`): it remembers the argument text streamed so far, by
 * pi-ai's content index. A turn without a forced call shares the stateless `PASS_THROUGH`.
 */
export interface ForcedCallAnswer {
  /** The events the consumer sees for one of pi-ai's events (none for free text). */
  translate(event: AssistantMessageEvent): AssistantMessageEvent[];
  /** The final message's content: the answer as a text block, thinking kept, free text dropped. */
  finalContent(content: Content): Content;
}

/** The translator of a turn without a forced call: events and content unchanged. Stateless, so one is shared. */
export const PASS_THROUGH: ForcedCallAnswer = { translate: (event) => [event], finalContent: (content) => content };

/** The translator for one turn that has a forced response-schema tool call (see `ForcedCallAnswer`). */
export function forcedCallAnswer(): ForcedCallAnswer {
  /** The argument text streamed so far for each call block, by pi-ai's content index. */
  const streamed = new Map<number, string>();

  /**
   * `content` as the consumer sees it. A call that has not ended shows only what was streamed (its
   * partial arguments are not JSON text); in the final message, a call that streamed nothing shows
   * its arguments (`complete`).
   */
  const view = (content: Content, complete: boolean): Content =>
    content.flatMap((block, index): Content => {
      if (block.type === "text") return [];
      if (block.type !== "toolCall") return [block];
      const text = streamed.get(index);
      return [{ type: "text", text: complete ? text || JSON.stringify(block.arguments) : (text ?? "") }];
    });

  /** The partial message the consumer sees for one of pi-ai's events. */
  const partialOf = (partial: AssistantMessage): AssistantMessage => ({ ...partial, content: view(partial.content, false) });

  /** `partialOf` the event's partial, and where the event's block sits once the free text is dropped. */
  const consumerView = (event: { contentIndex: number; partial: AssistantMessage }) => ({
    contentIndex: event.partial.content.slice(0, event.contentIndex).filter((block) => block.type !== "text").length,
    partial: partialOf(event.partial),
  });

  return {
    translate(event) {
      switch (event.type) {
        case "text_start":
        case "text_delta":
        case "text_end":
          return [];
        case "toolcall_start":
          streamed.set(event.contentIndex, "");
          return [{ type: "text_start", ...consumerView(event) }];
        case "toolcall_delta":
          streamed.set(event.contentIndex, (streamed.get(event.contentIndex) ?? "") + event.delta);
          return [{ type: "text_delta", delta: event.delta, ...consumerView(event) }];
        case "toolcall_end": {
          const out: AssistantMessageEvent[] = [];
          const shown = consumerView(event);
          let answer = streamed.get(event.contentIndex) ?? "";
          if (answer === "") {
            // A call without argument deltas: its arguments are the answer.
            answer = JSON.stringify(event.toolCall.arguments);
            streamed.set(event.contentIndex, answer);
            out.push({ type: "text_delta", delta: answer, ...shown });
          }
          out.push({ type: "text_end", content: answer, ...shown });
          return out;
        }
        case "done":
        case "error":
          return [event];
        default:
          return [{ ...event, ...("contentIndex" in event ? consumerView(event) : { partial: partialOf(event.partial) }) }];
      }
    },
    finalContent: (content) => view(content, true),
  };
}
