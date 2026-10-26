import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type, type Context, type Tool, type TranscriptContext } from "@earendil-works/pi-ai";
import { zeroUsage } from "@hk01/pi-ai-extra-internal/pi-ai";
import { createOpenRouterProvider } from "@hk01/pi-ai-extra-openrouter/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit, type ChatAssistantMessage, type ChatKit, type ChatToolFreeContext } from "../src/index.ts";
import {
  anthropicEvents,
  chatProviders,
  completionsChunk,
  contextOf,
  jsonBody,
  outcome,
  run,
  runToEnd,
  sseResponse,
  testDocument,
  testKit,
  turn,
  wireFetch,
  type TestTurn,
} from "./helpers.ts";

const ALL = ["google", "openrouter", "kie", "toapis"] as const;

/** A conversation that already holds a tool call and its result, as an agent session leaves it. */
const TOOL_HISTORY: Context["messages"] = [
  { role: "user", content: "Look it up", timestamp: 1 },
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "t1", name: "lookup", arguments: { q: "cats" } }],
    api: "openai-completions",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    usage: zeroUsage(),
    stopReason: "toolUse",
    timestamp: 2,
  },
  { role: "toolResult", toolCallId: "t1", toolName: "lookup", content: [{ type: "text", text: "found" }], isError: false, timestamp: 3 },
];

const LOOKUP: Tool = { name: "lookup", description: "Looks something up.", parameters: Type.Object({ q: Type.String() }) };

/** A kit whose fetch fails the test if anything is sent. */
function offlineKit() {
  const fake = createFakeFetch([]);
  return { chat: testKit(ALL, fake.fetch), fake };
}

/** A turn the kit fails before sending: one lone `error` event, no `start`, and nothing sent but model lists. */
async function failure(input: TestTurn, signal?: AbortSignal) {
  const { chat, fake } = offlineKit();
  const { events, message } = await runToEnd(chat, input, signal);
  assert.deepEqual(
    events.map((event) => event.type),
    ["error"],
    "a failure found before sending is a lone error event, as in pi-ai's lazyStream",
  );
  assert.deepEqual(
    fake.calls.filter((call) => call.method !== "GET").map((call) => call.url),
    [],
    "nothing was sent",
  );
  assert.equal(message.stopReason, "error");
  assert.equal(message.usage.input, 0, "message.usage stays pi-ai's zero-filled usage");
  assert.equal(message.chatKit.usage, undefined);
  if (message.stopReason !== "error") throw new Error("unreachable");
  return { code: message.chatKit.error.code, text: message.errorMessage ?? "", message };
}

describe("createChatKit registration", () => {
  it("throws for a value that is not a chat provider, and for a provider without chatKit traits", () => {
    assert.throws(() => createChatKit({ providers: [{} as never] }), /providers\[0\] has no pi-ai provider id/);
    assert.throws(() => createChatKit({ providers: [null as never] }), /providers\[0\] is not a provider object/);
    const [google] = chatProviders(["google"], undefined);
    const { chatKit: _traits, ...plain } = google!;
    assert.throws(() => createChatKit({ providers: [plain as never] }), /providers\[0\] \("google"\) has no chatKit traits/);
    assert.throws(
      () => createChatKit({ providers: [{ ...google!, chatKit: { ...google!.chatKit, estimatesCost: "yes" as never } }] }),
      /incomplete chatKit traits/,
    );
    assert.throws(() => createChatKit({ providers: [], fetch: "nope" as never }), /options\.fetch: must be a function/);
  });

  it("throws for two providers with the same pi-ai id: a second key for the same provider is a second kit", () => {
    assert.throws(
      () => createChatKit({ providers: [...chatProviders(["google"], undefined), ...chatProviders(["google"], undefined, { keys: { google: "b" } })] }),
      /two providers have the id "google"/,
    );
  });

  it("keeps two kits apart, each sending only its own key", async () => {
    const sentKeys: string[] = [];
    for (const key of ["tenant-a", "tenant-b"]) {
      const fake = createFakeFetch([
        {
          method: "POST",
          url: "https://openrouter.ai/api/v1/chat/completions",
          respond: (request) => {
            sentKeys.push(`${key}:${request.headers.authorization}`);
            return sseResponse([completionsChunk({ content: "ok" }, "stop"), "[DONE]"]);
          },
        },
      ]);
      const chat = testKit(["openrouter"], wireFetch(fake), { keys: { openrouter: key } });
      assert.equal((await outcome(chat, turn())).type, "done");
    }
    assert.deepEqual(sentKeys, ["tenant-a:Bearer tenant-a", "tenant-b:Bearer tenant-b"]);
  });
});

describe("a turn that fails before anything is sent", () => {
  it("UNKNOWN_MODEL for an unregistered provider id or a model outside the model list; the message names the reference", async () => {
    const unknownProvider = await failure(turn({ provider: "nope" }));
    assert.equal(unknownProvider.code, "UNKNOWN_MODEL");
    assert.equal(unknownProvider.text, '[nope/openai/gpt-4o-mini] No provider with the id "nope" is registered.');
    assert.equal(unknownProvider.message.provider, "nope", "provider and model come from the reference");
    assert.equal(unknownProvider.message.model, "openai/gpt-4o-mini");
    assert.equal(unknownProvider.message.api, "unknown", "no model resolved");
    const unknownModel = await failure(turn({ provider: "google", model: "gemini-9-ultra" }));
    assert.equal(unknownModel.code, "UNKNOWN_MODEL");
    assert.match(unknownModel.text, /^\[google\/gemini-9-ultra\] Model "gemini-9-ultra" is not offered by provider google \(its live model list could not be read: /);
    assert.equal((await failure(turn({ provider: "kie", model: "gpt-5.3-codex" }))).code, "UNKNOWN_MODEL");
  });

  it("UNSUPPORTED for PDFs or images on KIE and ToAPIs, an unknown type, or a text-only model", async () => {
    const pdf = testDocument("brief.pdf", "application/pdf", "%PDF");
    const kie = await failure(turn({ provider: "kie", model: "claude-sonnet-4-6", documents: [pdf] }));
    assert.equal(kie.code, "UNSUPPORTED");
    assert.match(kie.text, /Provider kie does not take PDF or image documents yet/);
    assert.equal(
      (await failure(turn({ provider: "toapis", model: "claude-haiku-4-5", documents: [testDocument("a.png", "image/png", "x")] }))).code,
      "UNSUPPORTED",
    );
    const docx = await failure(
      turn({ documents: [testDocument("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x")] }),
    );
    assert.equal(docx.code, "UNSUPPORTED");
    assert.match(docx.text, /supported types are text\/plain, text\/markdown/);
    const textOnly = await failure(turn({ model: "aion-labs/aion-2.0", documents: [pdf] }));
    assert.equal(textOnly.code, "UNSUPPORTED");
    assert.match(textOnly.text, /takes text only/);
    assert.equal(pdf.loads, 0, "nothing is loaded for a rejected request");
  });

  it("UNSUPPORTED for tools on a provider not yet verified live (KIE, ToAPIs), without sending anything", async () => {
    const kie = await failure(turn({ provider: "kie", model: "claude-sonnet-4-6", tools: [LOOKUP] }));
    assert.equal(kie.code, "UNSUPPORTED");
    assert.match(kie.text, /Provider kie does not take tools yet/);
    assert.equal((await failure(turn({ provider: "toapis", model: "claude-haiku-4-5", tools: [LOOKUP] }))).code, "UNSUPPORTED");
  });

  it("UNSUPPORTED for an image in the context on a model without image input, instead of pi-ai's placeholder text", async () => {
    const context: Context = {
      messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", data: "eA==", mimeType: "image/png" }], timestamp: 1 }],
    };
    const { chat } = offlineKit();
    // The live list is unreadable offline, so the installed catalogue answers: aion-labs/aion-2.0 is text-only.
    const message = await chat.completeSimple({ provider: "openrouter", id: "aion-labs/aion-2.0" }, context);
    assert.equal(message.stopReason, "error");
    assert.equal(message.chatKit.error?.code, "UNSUPPORTED");
    assert.match(message.errorMessage ?? "", /does not read images/);
  });

  it("INVALID_REQUEST for tools together with a response schema, from tools or from a transcript's toolsAdded", async () => {
    const both = await failure(turn({ tools: [LOOKUP], responseSchema: { name: "answer", schema: {} } }));
    assert.equal(both.code, "INVALID_REQUEST");
    assert.match(both.text, /tools or a response schema, not both/);

    // A pi-ai TranscriptContext carries its tools in a system message, so it satisfies ChatToolFreeContext.
    const transcript = {
      messages: [
        { role: "system", content: "Be brief.", toolsAdded: [LOOKUP], timestamp: 0 },
        { role: "user", content: "Hi", timestamp: 1 },
      ],
    } as unknown as TranscriptContext;
    const { chat } = offlineKit();
    const asToolFree: ChatToolFreeContext = transcript;
    const fromTranscript = await chat.completeSimple({ provider: "openrouter", id: "openai/gpt-4o-mini" }, asToolFree, {
      responseSchema: { name: "answer", schema: {} },
    });
    assert.equal(fromTranscript.chatKit.error?.code, "INVALID_REQUEST");
    assert.match(fromTranscript.errorMessage ?? "", /tools or a response schema, not both/);
  });

  it("UNSUPPORTED for a context that carries tool calls or tool results, on a provider that takes no tools, even when it declares none", async () => {
    const { chat, fake } = offlineKit();
    const message = await chat.completeSimple({ provider: "kie", id: "claude-sonnet-4-6" }, { messages: TOOL_HISTORY });
    assert.equal(message.chatKit.error?.code, "UNSUPPORTED");
    assert.match(message.errorMessage ?? "", /does not take tools yet/);
    assert.deepEqual(fake.calls.filter((call) => call.method !== "GET"), [], "nothing was sent");
  });

  it("sends a response schema over a conversation that holds tool calls or tool results: the provider decides, as for any request", async () => {
    // Anthropic's release notes (2025-02-27) say tools are no longer required beside tool_use and tool_result blocks; OpenAI's and Gemini's docs are silent.
    for (const [provider, id] of [["openrouter", "openai/gpt-4o-mini"], ["openrouter", "anthropic/claude-sonnet-4.6"]] as const) {
      const fake = createFakeFetch([
        { method: "POST", url: "https://openrouter.ai/api/v1/chat/completions", respond: () => sseResponse([completionsChunk({ content: "{}" }, "stop"), "[DONE]"]) },
        { method: "POST", url: /^https:\/\/openrouter\.ai\/api\/v1\/messages\b/, respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "tool_use", name: "answer", json: ["{}"] }], stopReason: "tool_use" })) },
      ]);
      const chat = testKit(["openrouter"], wireFetch(fake));
      const message = await chat.completeSimple({ provider, id }, { messages: TOOL_HISTORY }, { responseSchema: { name: "answer", schema: { type: "object" } } });
      assert.equal(message.stopReason, "stop", `${provider}/${id}`);
      const posts = fake.calls.filter((call) => call.method === "POST");
      assert.equal(posts.length, 1, "the request was sent");
      const body = JSON.stringify(jsonBody(posts[0]?.body));
      assert.match(body, /"name":"answer"|"response_format"/, `${id}: the schema is in the request`);
      assert.match(body, /tool_calls|tool_use/, `${id}: so is the tool call of the history`);
    }
  });

  for (const stopReason of ["aborted", "error"] as const) {
    it(`does not count what pi-ai drops before sending: an assistant message with stopReason "${stopReason}" and a partial tool call`, async () => {
      const dropped: Context["messages"] = [
        { role: "user", content: "Look it up", timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "t1", name: "lookup", arguments: {} }],
          api: "anthropic-messages",
          provider: "kie",
          model: "claude-sonnet-4-6",
          usage: zeroUsage(),
          stopReason,
          timestamp: 2,
        },
        { role: "user", content: "Never mind, just answer.", timestamp: 3 },
      ];
      const fake = createFakeFetch([
        { method: "POST", url: /^https:\/\/api\.kie\.ai\/anthropic\/v1\/messages\b/, respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "ok" }], stopReason: "end_turn" })) },
      ]);
      const chat = testKit(["kie"], wireFetch(fake));
      const ref = { provider: "kie", id: "claude-sonnet-4-6" };
      const firstTurn = await chat.completeSimple(ref, { messages: dropped });
      assert.equal(firstTurn.stopReason, "stop", "KIE takes no tools, and the request holds no tool block");
      // The same partial call in a message pi-ai keeps is refused: it would reach the wire.
      const kept = dropped.map((message) => (message.role === "assistant" ? { ...message, stopReason: "toolUse" as const } : message));
      const refused = await chat.completeSimple(ref, { messages: kept });
      assert.equal(refused.chatKit.error?.code, "UNSUPPORTED");
      assert.equal(fake.calls.filter((call) => call.method === "POST").length, 1, "only the first turn was sent");
    });
  }

  it("answers a malformed context with INVALID_REQUEST, for a known and an unknown model alike, and never throws", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwingGetter = Object.defineProperty({ role: "user" }, "content", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const throwingProxy = new Proxy({ role: "user", content: "x" }, {
      get() {
        throw new Error("boom");
      },
    });
    const withMessages = (...messages: unknown[]) => ({ messages });
    const malformed: Record<string, unknown> = {
      "messages missing": {},
      "messages a string": { messages: "hello" },
      "systemPrompt a number": { messages: [], systemPrompt: 5 },
      "a tool that is null": { messages: [], tools: [null] },
      "a tool without a description": { messages: [], tools: [{ name: "a", parameters: {} }] },
      "a tool with cyclic parameters": { messages: [], tools: [{ name: "a", description: "d", parameters: cyclic }] },
      "assistant content a string": withMessages({ role: "assistant", content: "plain text" }),
      "assistant content a number": withMessages({ role: "assistant", content: 5 }),
      "assistant content null": withMessages({ role: "assistant", content: null }),
      "assistant content missing": withMessages({ role: "assistant" }),
      "user content null": withMessages({ role: "user", content: null }),
      "user content missing": withMessages({ role: "user" }),
      "tool result content null": withMessages({ role: "toolResult", content: null }),
      "system content null": withMessages({ role: "system", content: null }),
      "assistant content with a null block": withMessages({ role: "assistant", content: [null] }),
      "assistant content with an undefined block": withMessages({ role: "assistant", content: [undefined] }),
      "assistant block without a type": withMessages({ role: "assistant", content: [{}] }),
      "user content holding a string": withMessages({ role: "user", content: ["hello"] }),
      "user content a number": withMessages({ role: "user", content: 5 }),
      "tool result content a string": withMessages({ role: "toolResult", content: "found" }),
      "system content a number": withMessages({ role: "system", content: 5 }),
      "toolsAdded a number": withMessages({ role: "system", content: "x", toolsAdded: 5 }),
      "toolsAdded an object": withMessages({ role: "system", content: "x", toolsAdded: {} }),
      "toolsAdded with a null entry": withMessages({ role: "system", content: "x", toolsAdded: [null] }),
      "toolsAdded with an entry without a name": withMessages({ role: "system", content: "x", toolsAdded: [{}] }),
      "toolsRemoved a number": withMessages({ role: "system", content: "x", toolsRemoved: 5 }),
      "toolsRemoved with an entry without a name": withMessages({ role: "system", content: "x", toolsRemoved: [{}] }),
      "a null message": withMessages(null),
      "a message without a role": withMessages({ content: "x" }),
      "a message with an unknown role": withMessages({ role: "tool", content: "x" }),
      "a string message": withMessages("hello"),
      "a message whose getter throws": withMessages(throwingGetter),
      "a message that is a throwing proxy": withMessages(throwingProxy),
    };
    const { chat } = offlineKit();
    const schema = { name: "a", schema: {} };
    for (const [label, context] of Object.entries(malformed)) {
      for (const ref of [{ provider: "openrouter", id: "openai/gpt-4o-mini" }, { provider: "openrouter", id: "no/such-model" }, { provider: "nope", id: "m" }]) {
        const plain = await chat.completeSimple(ref, context as ChatToolFreeContext);
        assert.equal(plain.chatKit.error?.code, "INVALID_REQUEST", `${label} on ${ref.id}`);
        const withSchema = await chat.completeSimple(ref, context as ChatToolFreeContext, { responseSchema: schema });
        assert.equal(withSchema.chatKit.error?.code, "INVALID_REQUEST", `${label} on ${ref.id} with a schema`);
      }
    }
  });

  it("answers INVALID_REQUEST, never throws, for a reference, options or response schema that cannot be read or sent", async () => {
    const { chat } = offlineKit();
    const known = { provider: "openrouter", id: "openai/gpt-4o-mini" };
    const context: ChatToolFreeContext = { messages: [{ role: "user", content: "Hi", timestamp: 1 }] };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwing = (name: string) => Object.defineProperty({}, name, { enumerable: true, get: () => { throw new Error("boom"); } });
    const cases: Record<string, () => Promise<ChatAssistantMessage>> = {
      "a reference whose getter throws": () => chat.completeSimple(throwing("provider") as never, context),
      "options whose getter throws": () => chat.completeSimple(known, context, throwing("signal") as never),
      "a cyclic response schema": () => chat.completeSimple(known, context, { responseSchema: { name: "a", schema: cyclic } }),
      "a response schema holding a BigInt": () => chat.completeSimple(known, context, { responseSchema: { name: "a", schema: { n: 1n } } }),
      "a response schema whose getter throws": () => chat.completeSimple(known, context, { responseSchema: { name: "a", schema: throwing("type") } }),
    };
    for (const [label, call] of Object.entries(cases)) {
      const message = await call();
      assert.equal(message.chatKit.error?.code, "INVALID_REQUEST", label);
    }
  });

  it("keeps the INVALID_REQUEST text short for a context of thousands of malformed messages", async () => {
    const { chat } = offlineKit();
    const messages = Array.from({ length: 2000 }, () => "not a message");
    const message = await chat.completeSimple({ provider: "nope", id: "m" }, { messages } as unknown as ChatToolFreeContext);
    assert.equal(message.chatKit.error?.code, "INVALID_REQUEST");
    assert.match(message.errorMessage ?? "", /context: and 1990 more/);
    assert.ok((message.errorMessage ?? "").length < 1500, `${message.errorMessage?.length} characters`);
  });

  it("accepts every ordinary message shape, and a tool list that is null, which pi-ai sends: strings, blocks, thinking, images, tool calls, results, system messages", async () => {
    const assistant = { role: "assistant", api: "openai-completions", provider: "openrouter", model: "m", usage: zeroUsage(), timestamp: 4 };
    const system = { role: "system", timestamp: 0 };
    const accepted: Record<string, unknown[]> = {
      "an ordinary conversation": [
        { ...system, content: [{ type: "text", text: "Be brief." }], toolsAdded: [LOOKUP] },
        { role: "user", content: [{ type: "text", text: "Hi" }, { type: "image", data: "eA==", mimeType: "image/png" }], timestamp: 1 },
        ...TOOL_HISTORY,
        { ...assistant, content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "ok" }], stopReason: "stop" },
        { ...assistant, content: [], stopReason: "error" },
      ],
      "a user message of an empty string": [{ role: "user", content: "", timestamp: 1 }],
      "a user message of no blocks": [{ role: "user", content: [], timestamp: 1 }],
      "a tool result of no blocks": [{ role: "toolResult", toolCallId: "t", toolName: "lookup", content: [], isError: false, timestamp: 1 }],
      "an assistant block of a type the kit has no list of": [{ ...assistant, content: [{ type: "futureBlock" }], stopReason: "stop" }],
      "a system message with sections": [{ ...system, content: "x", sections: [{ name: "a", content: "b" }] }],
      "a system message removing a tool by name": [{ ...system, content: "x", toolsRemoved: [{ name: "lookup" }] }],
      "toolsAdded that is null": [{ ...system, content: "x", toolsAdded: null }],
      "toolsRemoved that is null": [{ ...system, content: "x", toolsRemoved: null }],
    };
    const { chat } = offlineKit();
    for (const [label, messages] of Object.entries(accepted)) {
      const message = await chat.completeSimple({ provider: "nope", id: "m" }, { messages } as unknown as ChatToolFreeContext);
      assert.equal(message.chatKit.error?.code, "UNKNOWN_MODEL", `${label}: nothing in it is rejected as malformed`);
    }
  });

  it("sends a conversation whose system messages have a null tool list, as pi-ai does", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: "https://openrouter.ai/api/v1/chat/completions", respond: () => sseResponse([completionsChunk({ content: "Hello." }, "stop"), "[DONE]"]) },
    ]);
    const chat = testKit(["openrouter"], wireFetch(fake));
    const stored = [
      { role: "system", content: "Be brief.", toolsAdded: null, toolsRemoved: null, timestamp: 0 },
      { role: "user", content: "Hi", timestamp: 1 },
    ] as unknown as ChatToolFreeContext["messages"];
    const message = await chat.completeSimple({ provider: "openrouter", id: "openai/gpt-4o-mini" }, { messages: stored });
    assert.equal(message.stopReason, "stop");
    assert.equal(fake.calls.filter((call) => call.method === "POST").length, 1, "the request was sent");
  });

  it("counts a tool call or tool result that pi-ai sends as tool history, whatever the stop reason, and nothing else", async () => {
    const assistant = (content: unknown, stopReason: string) => ({
      role: "assistant",
      content,
      api: "anthropic-messages",
      provider: "kie",
      model: "claude-sonnet-4-6",
      usage: zeroUsage(),
      stopReason,
      timestamp: 2,
    });
    const call = [{ type: "toolCall", id: "t1", name: "lookup", arguments: {} }];
    const user = { role: "user", content: "Look it up", timestamp: 1 };
    const result = { role: "toolResult", toolCallId: "t1", toolName: "lookup", content: [{ type: "text", text: "found" }], isError: false, timestamp: 3 };
    const counted: Record<string, unknown[]> = {
      "a lone tool result": [user, result],
      "a tool call that stopped with stop": [user, assistant(call, "stop")],
      "a tool call that stopped with length": [user, assistant(call, "length")],
      "a tool call that stopped with toolUse": [user, assistant(call, "toolUse")],
      "a tool call that is pending": [user, assistant(call, "pending")],
      "a tool call that is deferred": [user, assistant(call, "deferred")],
      "a tool call after text": [user, assistant([{ type: "text", text: "Looking." }, ...call], "toolUse")],
    };
    const notCounted: Record<string, unknown[]> = {
      "text only": [user, assistant([{ type: "text", text: "Hello" }], "stop")],
      "thinking and text": [user, assistant([{ type: "thinking", thinking: "hm" }, { type: "text", text: "Hello" }], "stop")],
      "no content": [user, assistant([], "stop")],
    };
    const fake = createFakeFetch([
      { method: "POST", url: /^https:\/\/api\.kie\.ai\/anthropic\/v1\/messages\b/, respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "ok" }], stopReason: "end_turn" })) },
    ]);
    const chat = testKit(["kie"], wireFetch(fake));
    const ref = { provider: "kie", id: "claude-sonnet-4-6" };
    for (const [label, messages] of Object.entries(counted)) {
      const message = await chat.completeSimple(ref, { messages } as unknown as Context);
      assert.equal(message.chatKit.error?.code, "UNSUPPORTED", `${label} is refused`);
    }
    assert.equal(fake.calls.filter((entry) => entry.method === "POST").length, 0, "nothing refused was sent");
    for (const [label, messages] of Object.entries(notCounted)) {
      const message = await chat.completeSimple(ref, { messages } as unknown as Context);
      assert.equal(message.stopReason, "stop", `${label} is sent`);
    }
    assert.equal(fake.calls.filter((entry) => entry.method === "POST").length, Object.keys(notCounted).length);
  });

  it("sends a conversation that holds tool calls and results on a provider that takes tools, tool blocks included, even when it declares no tools", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: "https://openrouter.ai/api/v1/chat/completions", respond: () => sseResponse([completionsChunk({ content: "Found it." }, "stop"), "[DONE]"]) },
    ]);
    const chat = testKit(["openrouter"], wireFetch(fake));
    const message = await chat.completeSimple({ provider: "openrouter", id: "openai/gpt-4o-mini" }, { messages: TOOL_HISTORY });
    assert.equal(message.stopReason, "stop");
    const sent = jsonBody(fake.calls.find((call) => call.method === "POST")?.body).messages as { role: string }[];
    assert.deepEqual(sent.map((entry) => entry.role), ["user", "assistant", "tool"], "the tool call and its result went to the provider");
  });

  it("counts an empty tools array as no tools", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        respond: () => sseResponse([completionsChunk({ content: "{}" }, "stop"), "[DONE]"]),
      },
    ]);
    const chat = testKit(["openrouter"], wireFetch(fake));
    assert.equal((await outcome(chat, turn({ tools: [], responseSchema: { name: "answer", schema: { type: "object" } } }))).type, "done");
  });

  it("INVALID_REQUEST for malformed input or a document that cannot be loaded", async () => {
    const { chat } = offlineKit();
    const ref = { provider: "openrouter", id: "openai/gpt-4o-mini" };
    const badOptions = await chat.completeSimple(ref, contextOf(turn()), { maxToken: 5 } as never);
    assert.equal(badOptions.chatKit.error?.code, "INVALID_REQUEST");
    assert.match(badOptions.errorMessage ?? "", /options: Unrecognized key: "maxToken"/);
    const badSchemaName = await failure(turn({ responseSchema: { name: "has space", schema: {} } }));
    assert.match(badSchemaName.text, /options\.responseSchema\.name: must be 1-64 letters/);
    const noUser = await chat.completeSimple(ref, { messages: [] }, { documents: [testDocument("a.md", "text/markdown", "x")] });
    assert.equal(noUser.chatKit.error?.code, "INVALID_REQUEST");
    assert.match(noUser.errorMessage ?? "", /Documents open the first user message/);
    const missing = {
      name: "gone.md",
      mimeType: "text/markdown",
      load: async (): Promise<Uint8Array> => {
        throw new Error("blob not found");
      },
    };
    const unloadable = await failure(turn({ documents: [missing] }));
    assert.equal(unloadable.code, "INVALID_REQUEST");
    assert.match(unloadable.text, /Document "gone.md" could not be loaded: blob not found/);
  });

  it("ends as aborted, without a chatKit error, when the signal is already aborted", async () => {
    const { chat } = offlineKit();
    const controller = new AbortController();
    controller.abort();
    const { events, message } = await runToEnd(chat, turn(), controller.signal);
    assert.deepEqual(events.map((event) => event.type), ["error"]);
    assert.equal(message.stopReason, "aborted");
    assert.equal(message.chatKit.error, undefined);
  });

  it("never throws, even for a reference or context that is not an object, and completeSimple never rejects", async () => {
    const { chat } = offlineKit();
    const message = await chat.completeSimple(null as never, null as never);
    assert.equal(message.stopReason, "error");
    assert.equal(message.chatKit.error?.code, "INVALID_REQUEST");
    assert.equal(message.provider, "?");
    assert.equal(message.model, "?");
    assert.match(message.errorMessage ?? "", /^\[\?\/\?\] /);
  });
});

describe("turn validation and records", () => {
  it("INVALID_REQUEST for a signal that is not an AbortSignal, instead of ignoring it", async () => {
    const { chat } = offlineKit();
    const message = await chat.completeSimple({ provider: "openrouter", id: "openai/gpt-4o-mini" }, contextOf(turn()), { signal: "x" } as never);
    assert.equal(message.chatKit.error?.code, "INVALID_REQUEST");
    assert.match(message.errorMessage ?? "", /options\.signal: must be an AbortSignal/);
  });

  it("gives every message its own zero-filled usage, and prefixes an abort with [provider/model]", async () => {
    const { chat } = offlineKit();
    const controller = new AbortController();
    controller.abort();
    const first = await chat.completeSimple({ provider: "nope", id: "m" }, contextOf(turn()));
    const second = await chat.completeSimple({ provider: "nope", id: "m" }, contextOf(turn()));
    assert.notEqual(first.usage, second.usage, "pi-ai may update a message's usage in place");
    const aborted = await chat.completeSimple({ provider: "openrouter", id: "openai/gpt-4o-mini" }, contextOf(turn()), { signal: controller.signal });
    assert.equal(aborted.stopReason, "aborted");
    assert.equal(aborted.errorMessage, "[openrouter/openai/gpt-4o-mini] The turn was aborted.");
  });

  it("carries the model's api on a failure or abort after the model resolved, and \"unknown\" before", async () => {
    const { chat } = offlineKit();
    const unsupported = await failure(turn({ provider: "kie", model: "claude-sonnet-4-6", tools: [LOOKUP] }));
    assert.equal(unsupported.message.api, "anthropic-messages");
    const controller = new AbortController();
    const slow = {
      name: "slow.md",
      mimeType: "text/markdown",
      load: async (): Promise<Uint8Array> => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Uint8Array();
      },
    };
    const aborted = await chat.completeSimple({ provider: "openrouter", id: "openai/gpt-4o-mini" }, contextOf(turn()), { documents: [slow], signal: controller.signal });
    assert.equal(aborted.stopReason, "aborted");
    assert.equal(aborted.api, "openai-completions", "the model had resolved when the abort came");
    assert.equal((await failure(turn({ provider: "nope" }))).message.api, "unknown");
  });

  it("lists models as copies: changing a listed model changes neither the next listing nor another kit's", async () => {
    const first = testKit(["kie"], createFakeFetch([]).fetch);
    const [listed] = await first.listModels();
    assert.ok(listed && "models" in listed);
    const model = listed.models.find((entry) => entry.id === "claude-sonnet-4-6")!;
    const before = JSON.stringify(model);
    model.input.push("file" as never);
    model.cost.input = 999;
    (model.chatKit.rate as unknown as { periods: { input: number }[] }).periods[0]!.input = 999;
    const again = (await first.listModels())[0];
    const other = (await testKit(["kie"], createFakeFetch([]).fetch).listModels())[0];
    for (const entry of [again, other]) {
      assert.ok(entry && "models" in entry);
      assert.equal(JSON.stringify(entry.models.find((candidate) => candidate.id === "claude-sonnet-4-6")), before);
    }
  });

  it("sends a turn through the factory's fetch when the kit has none", async () => {
    const calls: string[] = [];
    const openrouter = createOpenRouterProvider({
      apiKey: "k",
      fetch: async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        return url.endsWith("/models") ? jsonResponse({ data: [] }) : sseResponse([completionsChunk({ content: "ok" }, "stop"), "[DONE]"]);
      },
    });
    const chat = createChatKit({ providers: [openrouter] });
    assert.equal((await outcome(chat, turn())).type, "done");
    assert.ok(calls.includes("POST https://openrouter.ai/api/v1/chat/completions"), calls.join(", "));
  });
});

describe("a turn on a provider that takes tools", () => {
  it("passes tools and tool calls through as pi-ai's: a toolUse stop with the call in the message", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        respond: () =>
          sseResponse([
            completionsChunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: '{"q":' } }] }),
            completionsChunk({ tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] }),
            completionsChunk({}, "tool_calls"),
            "[DONE]",
          ]),
      },
    ]);
    const chat = testKit(["openrouter"], wireFetch(fake));
    const { events, message } = await runToEnd(chat, turn({ tools: [LOOKUP] }));
    assert.equal(message.stopReason, "toolUse");
    assert.equal(message.chatKit.error, undefined);
    assert.deepEqual(
      message.content.flatMap((block) => (block.type === "toolCall" ? [[block.name, block.arguments]] : [])),
      [["lookup", { q: "cats" }]],
    );
    assert.ok(events.some((event) => event.type === "toolcall_end"), "pi-ai's tool-call events are passed through");
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual((body.tools as { function: { name: string } }[]).map((tool) => tool.function.name), ["lookup"]);
  });

  it("replays a final message, with its chatKit record, in the next turn's context", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        respond: () => sseResponse([completionsChunk({ content: "Hi" }, "stop"), "[DONE]"]),
      },
    ]);
    const chat = testKit(["openrouter"], wireFetch(fake));
    const ref = { provider: "openrouter", id: "openai/gpt-4o-mini" };
    const first = await chat.completeSimple(ref, contextOf(turn()));
    const context = contextOf(turn());
    const next = await chat.completeSimple(ref, { ...context, messages: [...context.messages, first, { role: "user", content: "And then?", timestamp: 3 }] });
    assert.equal(next.stopReason, "stop");
    const messages = jsonBody(fake.calls[1]?.body).messages as { role: string }[];
    assert.deepEqual(messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  });
});

describe("the call signatures", () => {
  /** Type-level checks: this function is compiled, never called. */
  async function signatures(chat: ChatKit, toolFree: ChatToolFreeContext, withTools: Context, maybeSchema: { name: string; schema: object } | undefined) {
    const ref = { provider: "google", id: "gemini-3.5-flash" };
    // A consumer's tool-free context for a Gem, with a schema that may be absent: the first overload.
    chat.streamSimple(ref, toolFree, { responseSchema: maybeSchema, documents: [], temperature: undefined });
    // An agent turn: tools in the context, no schema.
    chat.streamSimple(ref, withTools, { toolChoice: "auto", reasoning: "low" });
    // A pi-ai Model is a valid reference, and completeSimple has the same overloads.
    const listed = (await chat.listModels())[0];
    if (listed && "models" in listed && listed.models[0]) await chat.completeSimple(listed.models[0], toolFree, { responseSchema: maybeSchema });
    // @ts-expect-error a context with tools takes no response schema
    chat.streamSimple(ref, withTools, { responseSchema: { name: "x", schema: {} } });
    // @ts-expect-error toolChoice belongs to an agent turn
    chat.streamSimple(ref, toolFree, { toolChoice: "auto" });
  }
  it("compiles under exactOptionalPropertyTypes (checked by tsc)", () => {
    assert.equal(typeof signatures, "function");
  });

  it("returns pi-ai's event stream with the chat kit's record on its final message", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        respond: () => sseResponse([completionsChunk({ content: "Hi" }, "stop"), "[DONE]"]),
      },
    ]);
    const chat = testKit(["openrouter"], wireFetch(fake));
    const stream = run(chat, turn());
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    assert.equal(types[0], "start");
    assert.equal(types.at(-1), "done");
    const message = await stream.result();
    assert.equal(message.provider, "openrouter");
    assert.equal(message.model, "openai/gpt-4o-mini");
    assert.deepEqual(message.chatKit, {});
  });
});
