import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { zeroUsage } from "@hk01/pi-ai-extra-internal/pi-ai";
import { forcedCallAnswer, PASS_THROUGH } from "../src/schema-answer.ts";

type Block = AssistantMessage["content"][number];

const message = (content: Block[]): AssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "kie",
  model: "claude-sonnet-4-6",
  usage: zeroUsage(),
  stopReason: "stop",
  timestamp: 1,
});
const call = (args: Record<string, unknown>): Block => ({ type: "toolCall", id: "t1", name: "answer", arguments: args as never });
const text = (value: string): Block => ({ type: "text", text: value });
const thinking = (value: string): Block => ({ type: "thinking", thinking: value });

/** The events pi-ai emits for [thinking, free text, forced call], with the call's argument JSON in `chunks`. */
function piAiEvents(chunks: string[], args: Record<string, unknown>): AssistantMessageEvent[] {
  const events: AssistantMessageEvent[] = [
    { type: "thinking_start", contentIndex: 0, partial: message([thinking("")]) },
    { type: "thinking_end", contentIndex: 0, content: "hmm", partial: message([thinking("hmm")]) },
    { type: "text_start", contentIndex: 1, partial: message([thinking("hmm"), text("")]) },
    { type: "text_delta", contentIndex: 1, delta: "Sure! ", partial: message([thinking("hmm"), text("Sure! ")]) },
    { type: "text_end", contentIndex: 1, content: "Sure! ", partial: message([thinking("hmm"), text("Sure! ")]) },
    { type: "toolcall_start", contentIndex: 2, partial: message([thinking("hmm"), text("Sure! "), call({})]) },
  ];
  for (const delta of chunks) events.push({ type: "toolcall_delta", contentIndex: 2, delta, partial: message([thinking("hmm"), text("Sure! "), call({ partial: true })]) });
  events.push({ type: "toolcall_end", contentIndex: 2, toolCall: call(args) as never, partial: message([thinking("hmm"), text("Sure! "), call(args)]) });
  return events;
}

function translated(chunks: string[], args: Record<string, unknown>) {
  const answer = forcedCallAnswer();
  const events = piAiEvents(chunks, args).flatMap((event) => answer.translate(event));
  const final = answer.finalContent([thinking("hmm"), text("Sure! "), call(args)]);
  return { events, final };
}

describe("forcedCallAnswer", () => {
  it("turns the call into text events at the answer's own position, and drops the free text", () => {
    const { events, final } = translated(['{"ti', 'tle":"Hi"}'], { title: "Hi" });
    assert.deepEqual(
      events.map((event) => [event.type, "contentIndex" in event ? event.contentIndex : undefined]),
      [
        ["thinking_start", 0],
        ["thinking_end", 0],
        ["text_start", 1],
        ["text_delta", 1],
        ["text_delta", 1],
        ["text_end", 1],
      ],
      "the free text block is gone, so the answer is block 1 in the events…",
    );
    assert.deepEqual(final.map((block) => block.type), ["thinking", "text"]);
    assert.equal(final[1]?.type === "text" && final[1].text, '{"title":"Hi"}', "…and block 1 in the final message");
    for (const event of events) {
      if ("partial" in event) assert.ok(!event.partial.content.some((block) => block.type === "toolCall" || (block.type === "text" && block.text === "Sure! ")), event.type);
    }
    const end = events.at(-1);
    assert.equal(end?.type === "text_end" && end.content, '{"title":"Hi"}');
  });

  it("shows the text streamed so far in each partial, not the call's partial arguments", () => {
    const { events } = translated(['{"a":', "1}"], { a: 1 });
    const partials = events.flatMap((event) => (event.type === "text_start" || event.type === "text_delta" ? [(event.partial.content[1] as { text: string }).text] : []));
    assert.deepEqual(partials, ["", '{"a":', '{"a":1}']);
  });

  it("streams an empty call's arguments as one text_delta, so a loop over text_delta sees the same answer as the message", () => {
    const { events, final } = translated([""], {});
    const deltas = events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : []));
    assert.equal(deltas.join(""), "{}");
    assert.equal(final[1]?.type === "text" && final[1].text, "{}");
    const noChunks = translated([], {});
    assert.equal(noChunks.events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : [])).join(""), "{}");
  });

  it("keeps a failed call's streamed text as the answer, and an empty failed call as its arguments", () => {
    const answer = forcedCallAnswer();
    for (const event of piAiEvents(['{"ti'], {}).slice(0, -1)) answer.translate(event);
    const answerText = (content: Block[]) => (answer.finalContent(content).find((block) => block.type === "text") as { text: string }).text;
    assert.equal(answerText([thinking("a"), text("b"), call({ x: 1 })]), '{"ti', "the streamed text wins over the arguments");
    assert.equal(answerText([call({ x: 1 })]), '{"x":1}', "a call nothing was streamed for answers with its arguments");
  });

  it("passes a turn without a forced call through unchanged: the same events, and the same content", () => {
    for (const event of piAiEvents(['{"a":1}'], { a: 1 })) assert.deepEqual(PASS_THROUGH.translate(event), [event]);
    const content = [thinking("hmm"), text("Sure! "), call({ a: 1 })];
    assert.equal(PASS_THROUGH.finalContent(content), content);
  });
});
