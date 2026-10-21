import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { jsonResponse, type FakeFetch } from "@hk01/pi-ai-extra-internal/testing";
import type { AssistantMessage, AssistantMessageEvent, Context, Message, ThinkingLevel, Tool } from "@earendil-works/pi-ai";
import { createGoogleProvider } from "@hk01/pi-ai-extra-google/pi-ai";
import { createKieProvider } from "@hk01/pi-ai-extra-kie/pi-ai";
import { createOpenRouterProvider } from "@hk01/pi-ai-extra-openrouter/pi-ai";
import { createToapisProvider } from "@hk01/pi-ai-extra-toapis/pi-ai";
import { createChatKit, type ChatProvider } from "../src/index.ts";
import type { ChatAssistantMessage, ChatTurnErrorCode, ChatUsage, ChatDocument, ChatKit, ChatResponseSchema, ChatStreamOptions, ChatTurnStream } from "../src/index.ts";

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
        supported_parameters: model.reasoning ? ["reasoning", "tools"] : ["tools"],
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

/** A turn as the tests describe it: what a consumer's Gem helper would turn into pi-ai's `Context` and the options. */
export interface TestTurn {
  provider: string;
  model: string;
  systemPrompt: string;
  documents: readonly ChatDocument[];
  history: readonly { role: "user" | "assistant"; text: string }[];
  message: string;
  responseSchema?: ChatResponseSchema | undefined;
  settings?: { temperature?: number; maxTokens?: number; reasoning?: ThinkingLevel } | undefined;
  tools?: Tool[] | undefined;
}

export function turn(overrides: Partial<TestTurn> = {}): TestTurn {
  return {
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    systemPrompt: "You are a helpful Gem.",
    documents: [],
    history: [],
    message: "Hello",
    ...overrides,
  };
}

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** pi-ai's `Context` for a test turn. */
export function contextOf(input: TestTurn): Context {
  const messages: Message[] = input.history.map((entry) =>
    entry.role === "user"
      ? { role: "user", content: entry.text, timestamp: 1 }
      : {
          role: "assistant",
          content: [{ type: "text", text: entry.text }],
          api: "openai-completions",
          provider: input.provider,
          model: input.model,
          usage: ZERO_USAGE,
          stopReason: "stop",
          timestamp: 1,
        },
  );
  messages.push({ role: "user", content: input.message, timestamp: 2 });
  return { ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}), messages, ...(input.tools ? { tools: input.tools } : {}) };
}

/** Runs a test turn on the kit: pi-ai's `Context` and options built from it. */
export function run(chat: ChatKit, input: TestTurn, signal?: AbortSignal): ChatTurnStream {
  const options = {
    ...input.settings,
    ...(input.documents.length > 0 ? { documents: input.documents } : {}),
    ...(input.responseSchema ? { responseSchema: input.responseSchema } : {}),
    ...(signal ? { signal } : {}),
  };
  return chat.streamSimple({ provider: input.provider, id: input.model }, contextOf(input) as Context, options as unknown as ChatStreamOptions);
}

export async function collect(events: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const result: AssistantMessageEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

/** Runs a turn to its end: every event, and the final message. */
export async function runToEnd(chat: ChatKit, input: TestTurn, signal?: AbortSignal): Promise<{ events: AssistantMessageEvent[]; message: ChatAssistantMessage }> {
  const stream = run(chat, input, signal);
  const events = await collect(stream);
  return { events, message: await stream.result() };
}

export function textOf(events: readonly AssistantMessageEvent[]): string {
  return events.map((event) => (event.type === "text_delta" ? event.delta : "")).join("");
}

/** The text of the final message's text blocks. */
export function answerOf(message: AssistantMessage): string {
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

export function lastEvent(events: readonly AssistantMessageEvent[]): AssistantMessageEvent {
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

export function jsonBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(body) as Record<string, unknown>;
}

type ProviderName = "google" | "openrouter" | "kie" | "toapis";

/** One chat provider per name, each bound to its key and `fetch` (which serves its model list). */
export function chatProviders(
  names: readonly ProviderName[],
  fetch: typeof globalThis.fetch | undefined,
  extra: { grounding?: boolean; keys?: Partial<Record<ProviderName, string>> } = {},
): ChatProvider[] {
  const key = (name: ProviderName, fallback: string) => extra.keys?.[name] ?? fallback;
  const factories: Record<ProviderName, () => ChatProvider> = {
    google: () => createGoogleProvider({ apiKey: key("google", "g-key"), fetch, ...(extra.grounding ? { grounding: true } : {}) }),
    openrouter: () => createOpenRouterProvider({ apiKey: key("openrouter", "or-key"), fetch }),
    kie: () => createKieProvider({ apiKey: key("kie", "kie-key"), fetch }),
    toapis: () => createToapisProvider({ apiKey: key("toapis", "t-key"), fetch }),
  };
  return names.map((name) => factories[name]());
}

/** A kit over the named providers, with `fetch` for model lists and turns. */
export function testKit(names: readonly ProviderName[], fetch?: typeof globalThis.fetch, extra?: Parameters<typeof chatProviders>[2]): ChatKit {
  return createChatKit({ providers: chatProviders(names, fetch, extra), ...(fetch ? { fetch } : {}) });
}

/**
 * A turn's outcome in compact form, for assertions: `done` (with `truncated` for a `length` stop)
 * or `failed` (with the error's code, status, the raw stop reason and the message).
 */
export type Outcome =
  | { type: "done"; truncated?: true; usage?: ChatUsage }
  | { type: "aborted"; usage?: ChatUsage }
  | { type: "failed"; error: { code: ChatTurnErrorCode; reason?: string; status?: number; message: string }; usage?: ChatUsage };

export function outcomeOf(message: ChatAssistantMessage): Outcome {
  const usage = message.chatKit.usage === undefined ? {} : { usage: message.chatKit.usage };
  if (message.stopReason === "error") {
    return {
      type: "failed",
      error: {
        code: message.chatKit.error.code,
        ...(message.rawStopReason === undefined ? {} : { reason: message.rawStopReason }),
        ...(message.chatKit.error.status === undefined ? {} : { status: message.chatKit.error.status }),
        message: message.errorMessage ?? "",
      },
      ...usage,
    };
  }
  if (message.stopReason === "aborted") return { type: "aborted", ...usage };
  return { type: "done", ...(message.stopReason === "length" ? { truncated: true as const } : {}), ...usage };
}

/** Runs a turn to its end and returns its outcome in compact form. */
export async function outcome(chat: ChatKit, input: TestTurn, signal?: AbortSignal): Promise<Outcome> {
  return outcomeOf((await runToEnd(chat, input, signal)).message);
}
