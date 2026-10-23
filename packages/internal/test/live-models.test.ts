import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels, createProvider, type Model, type ProviderStreams } from "@earendil-works/pi-ai";
import { keepListed, withLiveChatModels, reportedAmount } from "../src/pi-ai/index.ts";
import { explicitApiKeyAuth } from "../src/pi-ai/auth.ts";

const model = (id: string): Model<"openai-responses"> => ({
  id,
  name: id,
  api: "openai-responses",
  provider: "t",
  baseUrl: "https://t.example",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
});
const streams = { stream: () => { throw new Error("unused"); }, streamSimple: () => { throw new Error("unused"); } } as unknown as ProviderStreams;
const base = () => createProvider<"openai-responses">({ id: "t", auth: explicitApiKeyAuth("T", "k"), models: [model("a"), model("b")], api: streams });
const collection = () => createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });

describe("withLiveChatModels", () => {
  it("serves the base models until a read succeeds, then replaces them, so a dropped model disappears", async () => {
    const provider = withLiveChatModels(base(), async () => [model("b"), model("c")]);
    const models = collection();
    models.setProvider(provider);
    assert.deepEqual(provider.getModels().map((entry) => entry.id), ["a", "b"]);
    assert.equal((await models.refresh({ providers: ["t"], force: true })).errors.size, 0);
    assert.deepEqual(provider.getModels().map((entry) => entry.id), ["b", "c"]);
    assert.deepEqual(provider.getAllModels?.().map((entry) => entry.id), ["b", "c"]);
  });

  it("keeps the previous list and surfaces the error when a read throws", async () => {
    let fail = false;
    const provider = withLiveChatModels(base(), async () => {
      if (fail) throw new Error("list is down");
      return [model("c")];
    });
    const models = collection();
    models.setProvider(provider);
    await models.refresh({ providers: ["t"], force: true });
    fail = true;
    const result = await models.refresh({ providers: ["t"], force: true });
    assert.match(result.errors.get("t")?.message ?? "", /list is down/);
    assert.deepEqual(provider.getModels().map((entry) => entry.id), ["c"]);
  });
});

describe("withLiveChatModels, aborted and superseded reads", () => {
  it("publishes nothing when the refresh was aborted after the read", async () => {
    const controller = new AbortController();
    const provider = withLiveChatModels(base(), async () => {
      controller.abort();
      return [model("late")];
    });
    const models = collection();
    models.setProvider(provider);
    await models.refresh({ providers: ["t"], force: true, signal: controller.signal });
    assert.deepEqual(provider.getModels().map((entry) => entry.id), ["a", "b"], "the aborted read did not replace the list");
  });
});

describe("model list helpers", () => {
  it("keeps the models a list names, matching dotted and dashed ids, and treats none as a failed read", () => {
    const kept = keepListed([model("gpt-5.6-sol"), model("x")], () => new Set(["gpt-5-6-sol"]), "T");
    assert.deepEqual(kept.map((entry) => entry.id), ["gpt-5.6-sol"]);
    assert.throws(() => keepListed([model("x")], () => new Set(), "T"), /name none of the package's chat models/);
  });

  it("reads a reported amount as a finite non-negative number", () => {
    assert.deepEqual([reportedAmount(0), reportedAmount(1.5), reportedAmount(-1), reportedAmount("1"), reportedAmount(Number.NaN)], [0, 1.5, undefined, undefined, undefined]);
  });
});
