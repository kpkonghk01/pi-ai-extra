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
 * One translator per turn: it remembers the argument text streamed so far, by pi-ai's content index.
 */
export interface ForcedCallAnswer {
  /** The events the consumer sees for one of pi-ai's events (none for free text). */
  translate(event: AssistantMessageEvent): AssistantMessageEvent[];
  /** The final message's content: the answer as a text block, thinking kept, free text dropped. */
  finalContent(content: Content): Content;
}

/** The events and content of a turn without a forced call: unchanged. */
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

  /** The consumer's partial message for one of pi-ai's events, and where its block sits once the free text is dropped. */
  const seen = (event: { contentIndex: number; partial: AssistantMessage }) => ({
    contentIndex: event.partial.content.slice(0, event.contentIndex).filter((block) => block.type !== "text").length,
    partial: { ...event.partial, content: view(event.partial.content, false) },
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
          return [{ type: "text_start", ...seen(event) }];
        case "toolcall_delta":
          streamed.set(event.contentIndex, (streamed.get(event.contentIndex) ?? "") + event.delta);
          return [{ type: "text_delta", delta: event.delta, ...seen(event) }];
        case "toolcall_end": {
          const out: AssistantMessageEvent[] = [];
          let answer = streamed.get(event.contentIndex) ?? "";
          if (answer === "") {
            // A call without argument deltas: its arguments are the answer.
            answer = JSON.stringify(event.toolCall.arguments);
            streamed.set(event.contentIndex, answer);
            out.push({ type: "text_delta", delta: answer, ...seen(event) });
          }
          out.push({ type: "text_end", content: answer, ...seen(event) });
          return out;
        }
        case "done":
        case "error":
          return [event];
        default:
          return [{ ...event, ..."contentIndex" in event ? { contentIndex: seen(event).contentIndex } : {}, partial: { ...event.partial, content: view(event.partial.content, false) } }];
      }
    },
    finalContent: (content) => view(content, true),
  };
}
