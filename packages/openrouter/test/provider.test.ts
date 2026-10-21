import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createFakeFetch, jsonResponse } from "@hk01/pi-ai-extra-internal/testing";
import { createOpenRouterProvider, isOfferedOpenRouterId, openRouterRate, openRouterThinkingLevelMap } from "../src/pi-ai/index.ts";

const LIST = {
  data: [
    {
      id: "acme/reader",
      name: "Acme: Reader",
      context_length: 100_000,
      top_provider: { max_completion_tokens: 8_000 },
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      id: "acme/painter",
      name: "Acme: Painter",
      architecture: { input_modalities: ["text"], output_modalities: ["text", "image"] },
      pricing: { prompt: "0.000001", completion: "0.000002" },
      supported_parameters: ["tools"],
    },
    {
      id: "acme/dispatcher",
      name: "Acme: Dispatcher",
      architecture: { input_modalities: ["text"], output_modalities: ["text"], tokenizer: "Router" },
      pricing: { prompt: "-1", completion: "-1" },
    },
    {
      id: "acme/talker",
      name: "Acme: Talker",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.000001", completion: "0.000002" },
      supported_parameters: [],
    },
    { id: "acme/embedder", architecture: { output_modalities: ["embeddings"] } },
  ],
};
const MODELS_URL = "https://openrouter.ai/api/v1/models";

function provider() {
  const fake = createFakeFetch([{ method: "GET", url: MODELS_URL, respond: () => jsonResponse(LIST) }]);
  return { provider: createOpenRouterProvider({ apiKey: "explicit-key", fetch: fake.fetch }), fake };
}

describe("createOpenRouterProvider", () => {
  it("extends pi-ai's openrouter provider: its id, catalogue, image and classifier models", () => {
    const base = openrouterProvider();
    const extended = createOpenRouterProvider({ apiKey: "k" });
    assert.equal(extended.id, "openrouter");
    assert.deepEqual(extended.getModels().map((model) => model.id), base.getModels().map((model) => model.id));
    assert.deepEqual(extended.getAllModels?.().map((model) => model.id), base.getAllModels?.().map((model) => model.id));
    assert.equal(typeof extended.generateImages, "function");
  });

  it("uses only the explicit key, never OPENROUTER_API_KEY", async () => {
    assert.throws(() => createOpenRouterProvider({ apiKey: " " }), /apiKey is required/);
    const resolved = await createOpenRouterProvider({ apiKey: "explicit-key" }).auth.apiKey?.resolve({
      ctx: { env: async () => "env-key", fileExists: async () => false },
      signal: new AbortController().signal,
    });
    assert.equal(resolved?.auth.apiKey, "explicit-key");
  });

  it("applies a base URL override to both chat APIs", () => {
    const models = createOpenRouterProvider({ apiKey: "k", baseUrl: "https://proxy.example.com/or/" }).getModels();
    const byApi = (api: string) => models.find((model) => model.api === api)?.baseUrl;
    assert.equal(byApi("openai-completions"), "https://proxy.example.com/or/v1");
    assert.equal(byApi("anthropic-messages"), "https://proxy.example.com/or");
  });

  it("replaces its chat models with the live list on refresh, so a model OpenRouter drops disappears", async () => {
    const { provider: openrouter, fake } = provider();
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(openrouter);
    const installedCount = openrouter.getModels().length;
    assert.ok(installedCount > 100);
    const result = await models.refresh({ providers: ["openrouter"], force: true });
    assert.equal(result.errors.size, 0);
    assert.deepEqual(
      openrouter.getModels().map((model) => model.id),
      ["acme/reader", "acme/painter", "acme/dispatcher", "acme/talker"],
      "text-answering models only; the embedding model is not a chat model",
    );
    assert.ok((openrouter.getAllModels?.() ?? []).some((model) => model.type === "image"), "image models stay pi-ai's");
    assert.equal(fake.calls[0]?.headers.authorization, undefined, "the public list is read without the key");
  });

  it("keeps the previous list and reports the error when a refresh fails", async () => {
    const fake = createFakeFetch([{ method: "GET", url: MODELS_URL, respond: () => jsonResponse({ error: { message: "down" } }, 503) }]);
    const openrouter = createOpenRouterProvider({ apiKey: "k", fetch: fake.fetch });
    const installed = openrouter.getModels().map((model) => model.id);
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(openrouter);
    const result = await models.refresh({ providers: ["openrouter"], force: true });
    assert.match(result.errors.get("openrouter")?.message ?? "", /HTTP 503/);
    assert.deepEqual(openrouter.getModels().map((model) => model.id), installed);
  });

  it("describes models for the chat kit from the live list: files, tools, rate, and what is offered", async () => {
    const { provider: openrouter } = provider();
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(openrouter);
    await models.refresh({ providers: ["openrouter"], force: true });
    const [reader, painter, dispatcher, talker] = openrouter.getModels();
    const { chatKit } = openrouter;
    assert.deepEqual(chatKit.takes, { fileDocuments: true, tools: true, nativeStructuredOutput: true });
    assert.deepEqual(chatKit.describe(reader!), { fileInput: true, tools: true, rate: openRouterRate({ prompt: "0.000003", completion: "0.000015" }) });
    assert.deepEqual([chatKit.describe(talker!).fileInput, chatKit.describe(talker!).tools], [false, false]);
    assert.deepEqual(
      [reader, painter, dispatcher, talker].map((model) => chatKit.offers(model!)),
      [true, false, false, true],
      "image output and a router tag leave a model out",
    );
  });

  it("describes installed models from pi-ai's catalogue: tools yes, files no, the catalogue price", () => {
    const openrouter = createOpenRouterProvider({ apiKey: "k" });
    const sonnet = openrouter.getModels().find((model) => model.id === "anthropic/claude-sonnet-4.6")!;
    const described = openrouter.chatKit.describe(sonnet);
    assert.deepEqual([described.fileInput, described.tools], [false, true]);
    assert.equal(described.rate?.periods[0]?.input, sonnet.cost.input);
    const offered = openrouter.getModels().filter((model) => openrouter.chatKit.offers(model));
    assert.ok(offered.length > 0 && offered.length < openrouter.getModels().length);
    assert.ok(offered.every((model) => isOfferedOpenRouterId(model.id)));
    assert.ok(!offered.some((model) => model.id.startsWith("google/gemini-3-pro-image") || model.id.startsWith("openrouter/")));
  });

  it("reads OpenRouter's own charge from usage.cost, and estimates a turn without one", () => {
    const { chatKit } = createOpenRouterProvider({ apiKey: "k" });
    assert.equal(chatKit.reportedCostUsd({ usage: { cost: 0.0042 } }), 0.0042);
    assert.equal(chatKit.reportedCostUsd({ usage: { cost: 0 } }), 0);
    assert.equal(chatKit.reportedCostUsd({ usage: { cost: "n/a" } }), undefined);
    assert.equal(chatKit.reportedCostUsd({}), undefined);
    assert.equal(chatKit.estimatesCost, true);
  });

  it("sends chat requests through the factory's fetch unless a request brings its own", async () => {
    const calls: string[] = [];
    const openrouter = createOpenRouterProvider({
      apiKey: "k",
      fetch: async (input) => {
        calls.push(String(input instanceof Request ? input.url : input));
        return new Response("{}", { status: 500 });
      },
    });
    const model = openrouter.getModels().find((candidate) => candidate.id === "openai/gpt-4o-mini")!;
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(openrouter);
    await models.completeSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 1 }] }, { maxRetries: 0 });
    assert.deepEqual(calls, ["https://openrouter.ai/api/v1/chat/completions"]);
  });
});

describe("OpenRouter metadata readers", () => {
  it("prices a model from per-token decimal strings, with a -1 price as no rate and the first prompt tier", () => {
    assert.deepEqual(openRouterRate({ prompt: "0.000003", completion: "0.000015" }), { periods: [{ input: 3, output: 15 }] });
    assert.equal(openRouterRate({ prompt: "-1", completion: "-1" }), undefined);
    assert.equal(openRouterRate(undefined), undefined);
    const tiered = openRouterRate({ prompt: "0.000002", completion: "0.00001", overrides: [{ min_prompt_tokens: 200_000, prompt: "0.000004", completion: "0.000015" }] });
    assert.deepEqual(tiered?.periods[0]?.largePrompt, { overPromptTokens: 200_000, input: 4, output: 15 });
  });

  it("maps reasoning metadata to pi-ai thinking levels", () => {
    assert.deepEqual(openRouterThinkingLevelMap({ mandatory: true }), { off: null });
    assert.deepEqual(openRouterThinkingLevelMap({ supported_efforts: ["low", "high", "none"] }), {
      off: "none",
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    });
    assert.equal(openRouterThinkingLevelMap(undefined), undefined);
  });
});

describe("isOfferedOpenRouterId", () => {
  it("leaves out :batch, :free, openrouter/*, named routers and -latest aliases", () => {
    for (const id of ["a/b:batch", "a/b:free", "openrouter/auto", "nvidia/switchyard", "~google/gemini-flash-latest"]) {
      assert.equal(isOfferedOpenRouterId(id), false, id);
    }
    assert.equal(isOfferedOpenRouterId("anthropic/claude-sonnet-4.6"), true);
    assert.equal(isOfferedOpenRouterId("sakana/fugu-1"), true, "versioned composites stay offered");
  });
});
