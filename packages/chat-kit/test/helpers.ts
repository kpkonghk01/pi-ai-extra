import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { jsonResponse, type FakeFetch } from "@hk01/pi-ai-extra-internal/testing";
import type { ChatDocument, ChatTurnEvent, ChatTurnInput } from "../src/index.ts";

/** A $/1M-token rate as OpenRouter's per-token decimal string. */
const perToken = (perMillion: number) => String(perMillion / 1_000_000);

/**
 * OpenRouter's live `/models` body for the models pi-ai's catalogue has (`:batch` and `:free`
 * ones included, for the kit to drop), as the catalogue describes them, except that a model that
 * reads images also reads files, as OpenRouter lists Claude, GPT and Gemini.
 */
export function openRouterLiveList(): { data: Record<string, unknown>[] } {
  return {
    data: openrouterProvider()
      .getModels()
      .map((model) => ({
        id: model.id,
        name: model.name,
        context_length: model.contextWindow,
        top_provider: { context_length: model.contextWindow, max_completion_tokens: model.maxTokens },
        architecture: { input_modalities: model.input.includes("image") ? ["text", "image", "file"] : ["text"], output_modalities: ["text"] },
        ...(model.cost.input === 0 && model.cost.output === 0
          ? {}
          : {
              pricing: {
                prompt: perToken(model.cost.input),
                completion: perToken(model.cost.output),
                ...(model.cost.cacheRead > 0 ? { input_cache_read: perToken(model.cost.cacheRead) } : {}),
                ...(model.cost.cacheWrite > 0 ? { input_cache_write: perToken(model.cost.cacheWrite) } : {}),
              },
            }),
        supported_parameters: model.reasoning ? ["reasoning"] : [],
      })),
  };
}

/**
 * A kit fetch for wire tests. Every provider's model-list request (a GET of a `/models` path) is
 * answered here and not recorded, so `fake.calls` holds only the turn's own requests: OpenRouter's
 * default list (`openrouter.ai`) with `openRouterLiveList()`, any other with a 503, so the
 * installed catalogue or definitions are used. Everything else goes to `fake`.
 */
export function wireFetch(fake: FakeFetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if ((init?.method ?? "GET") !== "GET" || !url.pathname.endsWith("/models")) return fake.fetch(input, init);
    return url.hostname === "openrouter.ai"
      ? jsonResponse(openRouterLiveList())
      : jsonResponse({ error: { message: "no model list in wire tests" } }, 503);
  };
}

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
  /** Replaces `message_start`'s usage (default: input, output, cache read and cache write counts). */
  usage?: Record<string, unknown>;
  /** Replaces `message_delta`'s usage (default `{ output_tokens: 9 }`); `null` leaves it out. */
  deltaUsage?: Record<string, unknown> | null;
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
          usage: input.usage ?? { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },
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
      ...(input.deltaUsage === null ? {} : { usage: input.deltaUsage ?? { output_tokens: 9 } }),
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
