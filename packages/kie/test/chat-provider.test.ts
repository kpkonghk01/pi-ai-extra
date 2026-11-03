import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createKieProvider, KIE_CHAT_MODELS } from "../src/pi-ai/index.ts";

const CODEX_URL = "https://api.kie.ai/openai/v1/models";
const CLAUDE_URL = "https://api.kie.ai/anthropic/v1/models";
const GEMINI_IDS = ["gemini-3-8-flash", "gemini-3-6-flash", "gemini-4-argon"];
const GEMINI_URL = (id: string) => `https://api.kie.ai/${id}-openai/v1/chat/completions`;
/** KIE's real stream shape: content, an empty chunk, a usage chunk with credits_consumed, [DONE]; no finish_reason. */
const KIE_GEMINI_SSE =
  [
    'data: {"choices":[{"delta":{"role":"assistant","content":"pong"},"index":0}],"created":1,"id":"chatcmpl-1","object":"chat.completion.chunk"}',
    'data: {"choices":[],"created":1,"id":"chatcmpl-2","object":"chat.completion.chunk"}',
    'data: {"choices":[],"created":1,"credits_consumed":0.01,"id":"chatcmpl-3","object":"chat.completion.chunk","usage":{"completion_tokens":2,"prompt_tokens":4,"total_tokens":83}}',
    "data: [DONE]",
  ].join("\n\n") + "\n\n";
const collection = () => createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });

describe("KIE chat provider", () => {
  it("replaces its Codex and Claude models with the definitions KIE's two lists name, matching dotted and dashed ids, and keeps the Gemini models no list can name", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: CODEX_URL, respond: () => jsonResponse({ data: [{ id: "gpt-5.6-sol" }, { id: "unknown-model" }] }) },
      { method: "GET", url: CLAUDE_URL, respond: () => jsonResponse({ data: [{ id: "claude-opus-5-5" }] }) },
    ]);
    const kie = createKieProvider({ apiKey: "kie-key", fetch: fake.fetch });
    const models = collection();
    models.setProvider(kie);
    assert.equal(kie.getModels().length, KIE_CHAT_MODELS.length);
    const result = await models.refresh({ providers: ["kie"], force: true });
    assert.equal(result.errors.size, 0);
    assert.deepEqual(kie.getModels().map((model) => model.id), ["gpt-5-6-sol", "claude-opus-5-5", ...GEMINI_IDS]);
    assert.ok(fake.calls.every((call) => call.headers.authorization === "Bearer kie-key"));
  });

  it("keeps the installed definitions, and says why, when a list answers with KIE's error envelope", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: CODEX_URL, respond: () => jsonResponse({ code: 401, msg: "You do not have access permissions" }) },
      { method: "GET", url: CLAUDE_URL, respond: () => jsonResponse({ data: [{ id: "claude-opus-5-5" }] }) },
    ]);
    const kie = createKieProvider({ apiKey: "bad", fetch: fake.fetch });
    const models = collection();
    models.setProvider(kie);
    const result = await models.refresh({ providers: ["kie"], force: true });
    assert.match(result.errors.get("kie")?.message ?? "", /code 401/);
    assert.equal(kie.getModels().length, KIE_CHAT_MODELS.length);
  });

  it("describes its traits: no documents or tools yet, native structured output, a credits-based charge and no estimate", () => {
    const { chatKit, getModels } = createKieProvider({ apiKey: "k" });
    assert.deepEqual(chatKit.takes, { fileDocuments: false, tools: false, nativeStructuredOutput: true });
    assert.equal(chatKit.estimatesCost, false);
    assert.equal(chatKit.reportedCostUsd({ credits_consumed: 0.48 }), 0.0024);
    assert.equal(chatKit.reportedCostUsd({ credits_consumed: -1 }), undefined);
    assert.equal(chatKit.reportedCostUsd({ usage: { input_tokens: 5 } }), undefined);
    const opus = getModels().find((model) => model.id === "claude-opus-5-5")!;
    assert.ok(chatKit.offers(opus));
    assert.deepEqual(chatKit.describe(opus).rate, KIE_CHAT_MODELS.find((model) => model.id === "claude-opus-5-5")?.rate);
    assert.equal(chatKit.describe(opus).fileInput, opus.input.includes("image"));
  });

  it("sends chat requests through the factory's fetch, wrapped by KIE's envelope handling", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: /^https:\/\/api\.kie\.ai\/anthropic\/v1\/messages\b/, respond: () => jsonResponse({ code: 402, msg: "Insufficient credits" }) },
    ]);
    const kie = createKieProvider({ apiKey: "k", fetch: fake.fetch });
    const models = collection();
    models.setProvider(kie);
    const model = kie.getModels().find((candidate) => candidate.id === "claude-sonnet-4-6")!;
    const message = await models.completeSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { maxRetries: 0 });
    assert.equal(message.stopReason, "error");
    assert.match(message.errorMessage ?? "", /KIE code 402: Insufficient credits/);
    assert.equal(fake.calls.length, 1);
  });

  it("offers KIE's Gemini models on OpenAI Chat Completions, each at its own base URL, reading images", () => {
    const models = createKieProvider({ apiKey: "k" }).getModels().filter((model) => model.api === "openai-completions");
    assert.deepEqual(models.map((model) => model.id), GEMINI_IDS);
    for (const model of models) {
      assert.equal(model.baseUrl, `https://api.kie.ai/${model.id}-openai/v1`, model.id);
      assert.deepEqual(model.input, ["text", "image"], model.id);
      assert.equal(model.contextWindow, 1_048_576, model.id);
      assert.equal(model.provider, "kie");
    }
  });

  it("prices 3.8 and 3.6 Flash at KIE's discount, then at its published regular price, and 4 Argon at its one published price", () => {
    const periods = (id: string) => KIE_CHAT_MODELS.find((model) => model.id === id)?.rate?.periods;
    for (const id of ["gemini-3-8-flash", "gemini-3-6-flash"]) {
      assert.deepEqual(periods(id), [{ input: 0.225, output: 1.125 }, { from: "2026-12-31", input: 0.45, output: 2.25 }], id);
    }
    assert.deepEqual(periods("gemini-4-argon"), [{ input: 0.8, output: 4 }]);
  });

  it("serves a Gemini definition at its own base URL, and refuses one on Chat Completions without a base URL", () => {
    const own = { id: "gemini-3-8-flash", protocol: "openai-completions" as const, baseUrl: "https://proxy.example.com/gemini-3-8-flash-openai/v1" };
    assert.equal(createKieProvider({ apiKey: "k", models: [own] }).getModels()[0]?.baseUrl, own.baseUrl);
    assert.throws(() => createKieProvider({ apiKey: "k", models: [{ id: "gemini-9", protocol: "openai-completions" }] }), /gemini-9 on openai-completions has no base URL/);
  });

  it("runs a Gemini turn: KIE's stream has no finish_reason, and the turn still ends as a normal stop", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: GEMINI_URL("gemini-3-8-flash"), respond: () => new Response(KIE_GEMINI_SSE, { headers: { "content-type": "text/event-stream;charset=UTF-8" } }) },
    ]);
    const kie = createKieProvider({ apiKey: "kie-key", fetch: fake.fetch });
    const models = collection();
    models.setProvider(kie);
    const model = kie.getModels().find((candidate) => candidate.id === "gemini-3-8-flash")!;
    const raw: unknown[] = [];
    const message = await models.completeSimple(model, { messages: [{ role: "user", content: "ping", timestamp: 1 }] }, { maxRetries: 0, onProviderStreamEvent: (event) => void raw.push(event) });
    assert.equal(message.stopReason, "stop");
    assert.deepEqual(message.content.map((block) => (block.type === "text" ? block.text : block.type)), ["pong"]);
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer kie-key");
    assert.ok(raw.some((event) => (event as { credits_consumed?: number }).credits_consumed === 0.01));
  });

  it("turns KIE's HTTP-200 error envelope on a Gemini route into an error carrying KIE's message", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: GEMINI_URL("gemini-4-argon"), respond: () => jsonResponse({ code: 422, msg: "The model is not supported", data: null }) },
    ]);
    const kie = createKieProvider({ apiKey: "k", fetch: fake.fetch });
    const models = collection();
    models.setProvider(kie);
    const model = kie.getModels().find((candidate) => candidate.id === "gemini-4-argon")!;
    const message = await models.completeSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { maxRetries: 0 });
    assert.equal(message.stopReason, "error");
    assert.match(message.errorMessage ?? "", /KIE code 422: The model is not supported/);
    assert.equal(fake.calls.length, 1);
  });

  it("reads no list for a package that has only Gemini models", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: CODEX_URL, respond: () => jsonResponse({ data: [{ id: "gpt-5.6-sol" }] }) },
      { method: "GET", url: CLAUDE_URL, respond: () => jsonResponse({ data: [{ id: "claude-opus-5-5" }] }) },
    ]);
    const kie = createKieProvider({ apiKey: "k", fetch: fake.fetch, models: KIE_CHAT_MODELS.filter((model) => model.protocol === "openai-completions") });
    const models = collection();
    models.setProvider(kie);
    const result = await models.refresh({ providers: ["kie"], force: true });
    assert.equal(result.errors.size, 0);
    assert.deepEqual(kie.getModels().map((model) => model.id), GEMINI_IDS);
    assert.equal(fake.calls.length, 0, "a package with only Gemini models has no list to read");
  });

  it("describes the Gemini models' traits: KIE's rate as published, a cost from KIE's credits", () => {
    const { chatKit, getModels } = createKieProvider({ apiKey: "k" });
    const flash = getModels().find((model) => model.id === "gemini-3-8-flash")!;
    assert.ok(chatKit.offers(flash));
    assert.equal(chatKit.describe(flash).fileInput, true);
    assert.deepEqual(chatKit.describe(flash).rate, KIE_CHAT_MODELS.find((model) => model.id === "gemini-3-8-flash")?.rate);
    assert.equal(chatKit.reportedCostUsd({ credits_consumed: 0.06 }), 0.0003);
  });
});
