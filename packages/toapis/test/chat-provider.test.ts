import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createToapisProvider, TOAPIS_CHAT_MODELS } from "../src/pi-ai/index.ts";

const MODELS_URL = "https://toapis.com/v1/models?type=text";
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

  it("describes its traits: nothing taken yet, every turn estimated from the definition's rate", () => {
    const { chatKit, getModels } = createToapisProvider({ apiKey: "k" });
    assert.deepEqual(chatKit.takes, { fileDocuments: false, tools: false, nativeStructuredOutput: false });
    assert.equal(chatKit.estimatesCost, true);
    assert.equal(chatKit.reportedCostUsd({ usage: { cost: 1 } }), undefined);
    const haiku = getModels().find((model) => model.id === "claude-haiku-4-5")!;
    assert.deepEqual(chatKit.describe(haiku).rate, TOAPIS_CHAT_MODELS.find((model) => model.id === "claude-haiku-4-5")?.rate);
  });
});
