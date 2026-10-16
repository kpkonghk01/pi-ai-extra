import type { ChatDocument, ChatTurnEvent, ChatTurnInput } from "../src/index.ts";

/** A server-sent-event response; each entry is one event (`data:` lines, optionally `event:`). */
export function sseResponse(events: readonly (string | { event: string; data: unknown })[], status = 200): Response {
  const body = events
    .map((entry) => (typeof entry === "string" ? `data: ${entry}\n\n` : `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`))
    .join("");
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

/** A stream that sends `events`, then fails mid-stream (after generation started). */
export function brokenSseResponse(events: readonly string[]): Response {
  const encoder = new TextEncoder();
  const pending = [...events];
  // Erroring a stream discards queued chunks, so the error is raised only once they were read.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const event = pending.shift();
      if (event === undefined) controller.error(new Error("connection reset"));
      else controller.enqueue(encoder.encode(`data: ${event}\n\n`));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function completionsChunk(
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "openai/gpt-4o-mini",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  });
}

export function completionsUsageChunk(usage: Record<string, unknown>): string {
  return JSON.stringify({ id: "gen-1", object: "chat.completion.chunk", created: 1, model: "openai/gpt-4o-mini", choices: [], usage });
}

export function anthropicEvents(input: {
  blocks: ({ type: "text"; text: string } | { type: "tool_use"; name: string; json: string[] })[];
  stopReason: string;
  usage?: Record<string, unknown>;
  messageExtra?: Record<string, unknown>;
  deltaExtra?: Record<string, unknown>;
}): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, ...input.usage },
          ...input.messageExtra,
        },
      },
    },
  ];
  input.blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({
        event: "content_block_start",
        data: { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      });
      events.push({
        event: "content_block_delta",
        data: { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
      });
    } else {
      events.push({
        event: "content_block_start",
        data: { type: "content_block_start", index, content_block: { type: "tool_use", id: "toolu_1", name: block.name, input: {} } },
      });
      for (const json of block.json) {
        events.push({
          event: "content_block_delta",
          data: { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } },
        });
      }
    }
    events.push({ event: "content_block_stop", data: { type: "content_block_stop", index } });
  });
  events.push({
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: input.stopReason, stop_sequence: null },
      usage: { output_tokens: 9 },
      ...input.deltaExtra,
    },
  });
  events.push({ event: "message_stop", data: { type: "message_stop" } });
  return events;
}

export async function collect(events: AsyncIterable<ChatTurnEvent>): Promise<ChatTurnEvent[]> {
  const result: ChatTurnEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

export function textOf(events: readonly ChatTurnEvent[]): string {
  return events.map((event) => (event.type === "text" ? event.delta : "")).join("");
}

export function lastEvent(events: readonly ChatTurnEvent[]): ChatTurnEvent {
  const last = events.at(-1);
  if (!last) throw new Error("no events");
  return last;
}

/** A document whose `load()` calls are counted. */
export function testDocument(
  name: string,
  mimeType: string,
  content: string | Uint8Array,
  extra: Partial<Pick<ChatDocument, "url" | "size">> = {},
): ChatDocument & { loads: number } {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const document = {
    name,
    mimeType,
    ...extra,
    loads: 0,
    load: async () => {
      document.loads += 1;
      return bytes;
    },
  };
  return document;
}

export function turn(overrides: Partial<ChatTurnInput> = {}): ChatTurnInput {
  return {
    provider: "router",
    model: "openai/gpt-4o-mini",
    systemPrompt: "You are a helpful Gem.",
    documents: [],
    history: [],
    message: "Hello",
    ...overrides,
  };
}

export function jsonBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(body) as Record<string, unknown>;
}
