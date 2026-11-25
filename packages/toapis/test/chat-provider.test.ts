import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createToapisProvider, TOAPIS_CHAT_MODELS } from "../src/pi-ai/index.ts";

const MODELS_URL = "https://api.toapis.com/v1/models?type=text";
const COMPLETIONS_URL = "https://api.toapis.com/v1/chat/completions";
const COMPLETIONS_SSE =
  [
    'data: {"id":"c1","object":"chat.completion.chunk","model":"gemini-4-argon","choices":[{"index":0,"delta":{"role":"assistant","content":"pong"}}]}',
    'data: {"id":"c1","object":"chat.completion.chunk","model":"gemini-4-argon","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}',
    "data: [DONE]",
  ].join("\n\n") + "\n\n";
const collection = () => createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });

describe("ToAPIs chat provider", () => {
  it("replaces its chat models with the package definitions /v1/models?type=text names", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: MODELS_URL, respond: () => jsonResponse({ data: [{ id: "claude-haiku-4-5" }, { id: "someone-elses-model" }] }) },
    ]);
    const toapis = createToapisProvider({ apiKey: "t-key", fetch: fake.fetch });
    const models = collection();
    models.setProvider(toapis);
    assert.equal(toapis.getModels().length, TOAPIS_CHAT_MODELS.length);
    const result = await models.refresh({ providers: ["toapis"], force: true });
    assert.equal(result.errors.size, 0);
    assert.deepEqual(toapis.getModels().map((model) => model.id), ["claude-haiku-4-5"]);
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer t-key");
  });

  it("keeps the installed definitions when the list names none of them", async () => {
    const fake = createFakeFetch([{ method: "GET", url: MODELS_URL, respond: () => jsonResponse({ data: [{ id: "other" }] }) }]);
    const toapis = createToapisProvider({ apiKey: "k", fetch: fake.fetch });
    const models = collection();
    models.setProvider(toapis);
    const result = await models.refresh({ providers: ["toapis"], force: true });
    assert.match(result.errors.get("toapis")?.message ?? "", /name none of the package's chat models/);
    assert.equal(toapis.getModels().length, TOAPIS_CHAT_MODELS.length);
  });

  it("runs a Gemini turn on Chat Completions with Bearer auth, the system prompt as a system message, a reasoning level as the nearest of low, medium and high", async () => {
    const sent: { reasoning_effort?: string; model: string; messages: { role: string }[] }[] = [];
    for (const reasoning of [undefined, "medium", "xhigh", "minimal"] as const) {
      const fake = createFakeFetch([
        { method: "POST", url: COMPLETIONS_URL, respond: () => new Response(COMPLETIONS_SSE, { headers: { "content-type": "text/event-stream" } }) },
      ]);
      const toapis = createToapisProvider({ apiKey: "t-key", fetch: fake.fetch });
      const models = collection();
      models.setProvider(toapis);
      const model = toapis.getModels().find((candidate) => candidate.id === "gemini-4-argon-official")!;
      const message = await models.completeSimple(model, { systemPrompt: "Be brief.", messages: [{ role: "user", content: "ping", timestamp: 1 }] }, { ...(reasoning && { reasoning }), maxRetries: 0 });
      assert.equal(message.stopReason, "stop");
      assert.equal(fake.calls[0]?.headers.authorization, "Bearer t-key");
      sent.push(JSON.parse(String(fake.calls[0]?.body)));
    }
    assert.deepEqual(sent.map((body) => body.model), Array(4).fill("gemini-4-argon-official"));
    assert.deepEqual(sent.map((body) => body.reasoning_effort), [undefined, "medium", "high", "low"]);
    // ToAPIs fails a Gemini request whose instructions come as a developer message (2026-11-25).
    assert.deepEqual(sent.map((body) => body.messages[0]?.role), Array(4).fill("system"));
  });

  it("describes its traits: nothing taken yet, every turn estimated from the definition's rate", () => {
    const { chatKit, getModels } = createToapisProvider({ apiKey: "k" });
    assert.deepEqual(chatKit.takes, { fileDocuments: false, tools: false, nativeStructuredOutput: false });
    assert.equal(chatKit.estimatesCost, true);
    assert.equal(chatKit.reportedCostUsd({ usage: { cost: 1 } }), undefined);
    const haiku = getModels().find((model) => model.id === "claude-haiku-4-5")!;
    assert.deepEqual(chatKit.describe(haiku).rate, TOAPIS_CHAT_MODELS.find((model) => model.id === "claude-haiku-4-5")?.rate);
  });
});
