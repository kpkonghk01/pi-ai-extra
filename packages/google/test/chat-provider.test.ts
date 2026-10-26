import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssistantMessageEventStream, createModels } from "@earendil-works/pi-ai";
import { zeroUsage } from "@hk01/pi-ai-extra-internal/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createGoogleProvider } from "../src/pi-ai/index.ts";
import { isOfferedGeminiId } from "../src/pi-ai/live-models.ts";
import { googleChatStreams, withGroundingTools } from "../src/pi-ai/streams.ts";

const MODELS_URL = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\?pageSize=1000/;
const models = () => createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });

describe("Google chat provider: live list", () => {
  it("replaces the catalogue with the key's generateContent models on refresh, keeping a known id's catalogue entry", async () => {
    const fake = createFakeFetch([
      {
        method: "GET",
        url: MODELS_URL,
        respond: () =>
          jsonResponse({
            models: [
              { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
              { name: "models/gemini-4-argon-preview", displayName: "Gemini 4 Argon", supportedGenerationMethods: ["generateContent"], thinking: true, inputTokenLimit: 2_000_000, outputTokenLimit: 100_000 },
              { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] },
            ],
          }),
      },
    ]);
    const google = createGoogleProvider({ apiKey: "gemini-key", fetch: fake.fetch });
    const collection = models();
    collection.setProvider(google);
    const installed = google.getModels().find((model) => model.id === "gemini-3.5-flash");
    const result = await collection.refresh({ providers: ["google"], force: true });
    assert.equal(result.errors.size, 0);
    assert.deepEqual(google.getModels().map((model) => model.id), ["gemini-3.5-flash", "gemini-4-argon-preview"]);
    assert.equal(google.getModels()[0]?.contextWindow, installed?.contextWindow, "a known id keeps pi-ai's entry");
    const argon = google.getModels()[1]!;
    assert.deepEqual([argon.name, argon.input, argon.reasoning, argon.contextWindow, argon.maxTokens], ["Gemini 4 Argon", ["text"], true, 2_000_000, 100_000]);
    assert.equal(fake.calls[0]?.headers["x-goog-api-key"], "gemini-key");
    assert.ok(google.getAllModels?.().some((model) => model.type === "image"), "image models stay");
  });

  it("narrows the live list to modelIds, and keeps the installed list when the read fails", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: MODELS_URL, respond: () => jsonResponse({ models: [{ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] }] }) },
    ]);
    const google = createGoogleProvider({ apiKey: "k", modelIds: ["gemini-2.5-pro"], fetch: fake.fetch });
    const collection = models();
    collection.setProvider(google);
    await collection.refresh({ providers: ["google"], force: true });
    assert.deepEqual(google.getModels().map((model) => model.id), ["gemini-2.5-pro"]);

    const down = createFakeFetch([{ method: "GET", url: MODELS_URL, respond: () => jsonResponse({ error: { message: "blocked" } }, 403) }]);
    const blocked = createGoogleProvider({ apiKey: "k", fetch: down.fetch });
    const installed = blocked.getModels().map((model) => model.id);
    const second = models();
    second.setProvider(blocked);
    const result = await second.refresh({ providers: ["google"], force: true });
    assert.match(result.errors.get("google")?.message ?? "", /HTTP 403/);
    assert.deepEqual(blocked.getModels().map((model) => model.id), installed);
  });
});

describe("Google chat provider: chatKit traits", () => {
  const { chatKit, getModels } = createGoogleProvider({ apiKey: "k" });

  it("takes documents and tools, not native structured output, and estimates every turn", () => {
    assert.deepEqual(chatKit.takes, { fileDocuments: true, tools: true, nativeStructuredOutput: false });
    assert.equal(chatKit.estimatesCost, true);
    assert.equal(chatKit.reportedCostUsd({ usageMetadata: { totalTokenCount: 5 } }), undefined);
  });

  it("offers plain text chat models only: no image-output, Live, embedding or -latest ids", () => {
    for (const id of ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-nano-banana-2.1", "gemini-3.1-flash-live-preview", "gemini-3.1-flash-lite-image", "nano-banana-pro-preview", "gemini-flash-latest", "text-embedding-9"]) {
      assert.equal(isOfferedGeminiId(id), false, id);
    }
    assert.equal(isOfferedGeminiId("gemini-3.5-flash"), true);
    const offered = getModels().filter((model) => chatKit.offers(model));
    assert.ok(offered.length > 0 && offered.length < getModels().length);
  });

  const flash = () => getModels().find((model) => model.id === "gemini-3.8-flash")!;
  /** What `describe()` reports for a model with this id, otherwise like Gemini 3.8 Flash. */
  const describeId = (id: string) => chatKit.describe({ ...flash(), id });

  it("reads PDFs when a Gemini model reads images, takes tools on Gemini models, and prices from the rate table", () => {
    const described = chatKit.describe(flash());
    assert.deepEqual([described.fileInput, described.tools], [true, true]);
    assert.equal(described.rate?.periods[0]?.input, 0.75);
    assert.equal(chatKit.describe({ ...flash(), input: ["text"] }).fileInput, false, "a Gemini model that reads no images reads no PDFs here");
  });

  it("takes tools on a Gemma 4 id and no PDFs: Google's Gemma page documents function calling for it, and its PDF page names Gemini models only", () => {
    for (const id of ["gemma-4-26b-a4b-it", "gemma-4-31b-it"]) {
      assert.deepEqual([describeId(id).tools, describeId(id).fileInput], [true, false], id);
    }
  });

  it("takes neither on any other id, until Google documents it: Gemma 3, a Gemma 4 lookalike, an unknown family", () => {
    for (const id of ["gemma-3-27b-it", "gemma-3n-e4b-it", "gemma-4", "gemma-40", "gemma-40b-it", "gemma-4n-e2b-it", "learnlm-2", "GEMMA-4-31B-IT"]) {
      assert.deepEqual([describeId(id).tools, describeId(id).fileInput], [false, false], id);
    }
  });

  it("sets no fetch trait: pi-ai's Gemini adapter rejects a custom fetch, so a turn cannot use one", () => {
    const { chatKit } = createGoogleProvider({ apiKey: "k", fetch: async () => new Response("{}") });
    assert.equal("fetch" in chatKit, false);
  });
});

describe("Google chat provider: grounding", () => {
  it("appends Google Search and URL context to config.tools, keeping the tools already there", () => {
    const next = withGroundingTools({ model: "m", config: { tools: [{ functionDeclarations: [] }], systemInstruction: "Be brief." } }) as { config: Record<string, unknown> };
    assert.deepEqual(next.config.tools, [{ functionDeclarations: [] }, { googleSearch: {} }, { urlContext: {} }]);
    assert.equal(next.config.systemInstruction, "Be brief.");
    assert.deepEqual((withGroundingTools({ model: "m" }) as { config: { tools: unknown } }).config.tools, [{ googleSearch: {} }, { urlContext: {} }]);
  });
});

describe("googleChatStreams", () => {
  const message = (extra: Record<string, unknown> = {}) => ({
    role: "assistant" as const,
    content: [],
    api: "google-generative-ai",
    provider: "google",
    model: "m",
    usage: zeroUsage(),
    stopReason: "error" as const,
    errorMessage: "Google stream ended without a finish reason",
    timestamp: 1,
    ...extra,
  });

  /** An inner stream that sends one payload through `onPayload`, observes one raw chunk, and ends with `final`. */
  function inner(chunk: unknown, final: ReturnType<typeof message>, sent: { payload?: unknown }) {
    const run = (_model: unknown, _context: unknown, options: Record<string, any> | undefined) => {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        sent.payload = (await options?.onPayload?.({ model: "m", config: {} }, {})) ?? { model: "m", config: {} };
        await options?.onProviderStreamEvent?.(chunk, {});
        stream.push({ type: "error", reason: "error", error: final });
        stream.end(final);
      })();
      return stream;
    };
    return { stream: run, streamSimple: run } as never;
  }

  it("copies a prompt block reason to rawStopReason, and leaves the caller's hooks working", async () => {
    const observed: unknown[] = [];
    const sent: { payload?: unknown } = {};
    const streams = googleChatStreams(inner({ promptFeedback: { blockReason: "BLOCKLIST" } }, message(), sent), false);
    const result = await streams.streamSimple({} as never, {} as never, { onProviderStreamEvent: (event: unknown) => void observed.push(event) } as never).result();
    assert.equal(result.rawStopReason, "BLOCKLIST");
    assert.equal(observed.length, 1, "the caller's observer still sees the chunk");
    assert.deepEqual(sent.payload, { model: "m", config: {} }, "no grounding tools without grounding");
  });

  it("keeps a stop reason pi-ai already set, and adds the grounding tools when grounding is on", async () => {
    const sent: { payload?: unknown } = {};
    const streams = googleChatStreams(inner({ promptFeedback: { blockReason: "BLOCKLIST" } }, message({ rawStopReason: "SAFETY" }), sent), true);
    const result = await streams.stream({} as never, {} as never, {} as never).result();
    assert.equal(result.rawStopReason, "SAFETY");
    assert.deepEqual((sent.payload as { config: { tools: unknown } }).config.tools, [{ googleSearch: {} }, { urlContext: {} }]);
  });

  it("settles result() with an error message when the inner stream ends without a final event, or throws", async () => {
    const endsEarly = { stream: () => createAssistantMessageEventStream(), streamSimple: () => { const stream = createAssistantMessageEventStream(); stream.end(); return stream; } } as never;
    const throwing = {
      streamSimple: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: message() };
          throw new Error("socket closed");
        },
        result: () => new Promise(() => undefined),
      }),
    } as never;
    const model = { id: "gemini-3.5-flash", api: "google-generative-ai", provider: "google" } as never;
    for (const [inner, expected] of [[endsEarly, /ended without a result/], [throwing, /socket closed/]] as const) {
      const result = await Promise.race([
        googleChatStreams(inner, false).streamSimple(model, {} as never, {} as never).result(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("result() never settled")), 1_000).unref()),
      ]);
      assert.equal(result.stopReason, "error");
      assert.match(result.errorMessage ?? "", expected);
      assert.deepEqual([result.api, result.provider, result.model], ["google-generative-ai", "google", "gemini-3.5-flash"]);
    }
  });

  const model = { id: "gemini-3.5-flash", api: "google-generative-ai", provider: "google" } as never;
  const silent = { streamSimple: () => { const stream = createAssistantMessageEventStream(); stream.end(); return stream; } } as never;

  it("reports an aborted request as aborted when the stream ended without a final event", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = await googleChatStreams(silent, false).streamSimple(model, {} as never, { signal: controller.signal } as never).result();
    assert.equal(aborted.stopReason, "aborted");
  });

  it("uses a result the source completed with through end(result), with the done reason it carries", async () => {
    for (const stopReason of ["stop", "length", "toolUse"] as const) {
      const completed = message({ stopReason, errorMessage: undefined, content: [{ type: "text", text: "hi" }] });
      const endsWithResult = { streamSimple: () => { const stream = createAssistantMessageEventStream(); stream.end(completed); return stream; } } as never;
      const wrapped = googleChatStreams(endsWithResult, false).streamSimple(model, {} as never, {} as never);
      const events = [];
      for await (const event of wrapped) events.push(event.type === "done" ? `done:${event.reason}` : event.type);
      assert.deepEqual(events, [`done:${stopReason}`]);
      assert.equal((await wrapped.result()).stopReason, stopReason);
    }
  });

  it("ends a result that is not a final one (pending) as an error, not as a done with a lying reason", async () => {
    const pending = message({ stopReason: "pending", errorMessage: undefined });
    const endsPending = { streamSimple: () => { const stream = createAssistantMessageEventStream(); stream.end(pending); return stream; } } as never;
    const wrapped = googleChatStreams(endsPending, false).streamSimple(model, {} as never, {} as never);
    const types: string[] = [];
    for await (const event of wrapped) types.push(event.type);
    assert.deepEqual(types, ["error"]);
    const result = await wrapped.result();
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /pending/);
  });

  it("settles with an error for a source that has no result() at all, without an unhandled rejection", async () => {
    const bare = {
      streamSimple: () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: message() };
        },
      }),
    } as never;
    const result = await Promise.race([
      googleChatStreams(bare, false).streamSimple(model, {} as never, {} as never).result(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("result() never settled")), 1_000).unref()),
    ]);
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /ended without a result/);
  });

  it("keeps the content streamed so far on the error it adds, and treats a thrown undefined as a failure", async () => {
    const partial = message({ content: [{ type: "text", text: "Hel" }], stopReason: "stop", errorMessage: undefined });
    const dies = (thrown: unknown) =>
      ({
        streamSimple: () => ({
          async *[Symbol.asyncIterator]() {
            yield { type: "text_delta", contentIndex: 0, delta: "Hel", partial };
            throw thrown;
          },
          result: () => new Promise(() => undefined),
        }),
      }) as never;
    const withText = await googleChatStreams(dies(new Error("reset")), false).streamSimple(model, {} as never, {} as never).result();
    assert.deepEqual(withText.content, [{ type: "text", text: "Hel" }]);
    assert.equal(withText.errorMessage, "reset");
    const thrownUndefined = await googleChatStreams(dies(undefined), false).streamSimple(model, {} as never, {} as never).result();
    assert.equal(thrownUndefined.stopReason, "error");
    assert.notEqual(thrownUndefined.errorMessage, "The Gemini stream ended without a result.", "a thrown undefined is still a failure, not an early end");
  });
});
