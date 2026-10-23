import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createKieProvider, KIE_CHAT_MODELS } from "../src/pi-ai/index.ts";

const CODEX_URL = "https://api.kie.ai/openai/v1/models";
const CLAUDE_URL = "https://api.kie.ai/anthropic/v1/models";
const collection = () => createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });

describe("KIE chat provider", () => {
  it("replaces its chat models with the package definitions KIE's two lists name, matching dotted and dashed ids", async () => {
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
    assert.deepEqual(kie.getModels().map((model) => model.id), ["gpt-5-6-sol", "claude-opus-5-5"]);
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
});
