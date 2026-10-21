import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type, type Context, type Tool, type TranscriptContext } from "@earendil-works/pi-ai";
import { createOpenRouterProvider } from "@hk01/pi-ai-extra-openrouter/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit, type ChatKit, type ChatToolFreeContext } from "../src/index.ts";
import {
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
    // A Gem helper's tool-free context with a schema that may be absent: the first overload.
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
