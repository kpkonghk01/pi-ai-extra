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

export function forcedCallAnswer(): ForcedCallAnswer {
  /** The argument text streamed so far for each call block, by pi-ai's content index. */
  const streamed = new Map<number, string>();

  /**
   * `content` as the consumer sees it. A call that has not ended shows only what was streamed (its
   * partial arguments are not JSON text); in the final message, a call that streamed nothing shows
   * its arguments.
   */
  const view = (content: Content, final: boolean): Content =>
    content.flatMap((block, index): Content => {
      if (block.type === "text") return [];
      if (block.type !== "toolCall") return [block];
      const text = streamed.get(index);
      return [{ type: "text", text: final ? text || JSON.stringify(block.arguments) : (text ?? "") }];
    });

  /** The position of pi-ai's content `index` once the free text before it is dropped. */
  const position = (partial: AssistantMessage, index: number): number => partial.content.slice(0, index).filter((block) => block.type !== "text").length;

  return {
    translate(event) {
      switch (event.type) {
        case "text_start":
        case "text_delta":
        case "text_end":
          return [];
        case "toolcall_start": {
          streamed.set(event.contentIndex, "");
          return [{ type: "text_start", contentIndex: position(event.partial, event.contentIndex), partial: { ...event.partial, content: view(event.partial.content, false) } }];
        }
        case "toolcall_delta": {
          streamed.set(event.contentIndex, (streamed.get(event.contentIndex) ?? "") + event.delta);
          return [
            {
              type: "text_delta",
              contentIndex: position(event.partial, event.contentIndex),
              delta: event.delta,
              partial: { ...event.partial, content: view(event.partial.content, false) },
            },
          ];
        }
        case "toolcall_end": {
          const out: AssistantMessageEvent[] = [];
          const contentIndex = position(event.partial, event.contentIndex);
          let answer = streamed.get(event.contentIndex) ?? "";
          if (answer === "") {
            // A call without argument deltas: its arguments are the answer.
            answer = JSON.stringify(event.toolCall.arguments);
            streamed.set(event.contentIndex, answer);
            out.push({ type: "text_delta", contentIndex, delta: answer, partial: { ...event.partial, content: view(event.partial.content, false) } });
          }
          out.push({ type: "text_end", contentIndex, content: answer, partial: { ...event.partial, content: view(event.partial.content, false) } });
          return out;
        }
        case "done":
        case "error":
          return [event];
        default: {
          const partial = { ...event.partial, content: view(event.partial.content, false) };
          return [{ ...event, ...("contentIndex" in event ? { contentIndex: position(event.partial, event.contentIndex) } : {}), partial }];
        }
      }
    },
    finalContent: (content) => view(content, true),
  };
}
