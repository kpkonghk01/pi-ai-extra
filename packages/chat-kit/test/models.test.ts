import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeFetch, jsonResponse, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit, type ChatModelInfo, type ChatProviderModels } from "../src/index.ts";
import { createModelList, FAILED_REFRESH_RETRY_MS, MODEL_LIST_TTL_MS, type ListedModel } from "../src/models/list.ts";
import { openRouterRate, openRouterThinkingLevelMap } from "../src/models/openrouter.ts";
import { collect, completionsChunk, completionsUsageChunk, jsonBody, lastEvent, sseResponse, testDocument, turn } from "./helpers.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const GEMINI_MODELS_URL = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\?pageSize=1000/;
const KIE_CODEX_MODELS_URL = "https://api.kie.ai/openai/v1/models";
const KIE_CLAUDE_MODELS_URL = "https://api.kie.ai/anthropic/v1/models";
const TOAPIS_MODELS_URL = "https://toapis.com/v1/models?type=text";

function listed(id: string): ListedModel {
  return { model: { id } as ListedModel["model"], rate: undefined, input: ["text"] };
}

/** A model list over a fake clock and a scripted live source. */
function scriptedList(results: (readonly string[] | Error)[]) {
  let clock = 0;
  let calls = 0;
  const list = createModelList({
    installed: [listed("installed-model")],
    now: () => clock,
    fetchLive: async () => {
      const result = results[Math.min(calls, results.length - 1)]!;
      calls += 1;
      if (result instanceof Error) throw result;
      return result.map(listed);
    },
  });
  return {
    list,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const ids = (models: readonly { model: { id: string } }[]) => models.map((entry) => entry.model.id);

describe("model list refresh rules", () => {
  it("keeps a live list for 30 minutes, then refreshes it", async () => {
    const { list, calls, advance } = scriptedList([["a"], ["a", "b"]]);
    assert.deepEqual(ids((await list.read()).models), ["a"]);
    advance(MODEL_LIST_TTL_MS - 1);
    assert.deepEqual(ids((await list.read()).models), ["a"]);
    assert.equal(calls(), 1);
    advance(1);
    const refreshed = await list.read();
    assert.deepEqual(ids(refreshed.models), ["a", "b"]);
    assert.equal(refreshed.source, "live");
    assert.equal(calls(), 2);
  });

  it("keeps the last good list when a refresh fails, says why, and retries after a minute", async () => {
    const { list, calls, advance } = scriptedList([["a"], new Error("HTTP 503"), ["b"]]);
    await list.read();
    advance(MODEL_LIST_TTL_MS);
    const failed = await list.read();
    assert.deepEqual([ids(failed.models), failed.source, failed.refreshError], [["a"], "live", "HTTP 503"]);
    advance(FAILED_REFRESH_RETRY_MS - 1);
    assert.equal((await list.read()).refreshError, "HTTP 503");
    assert.equal(calls(), 2, "no retry within a minute of a failure");
    advance(1);
    const recovered = await list.read();
    assert.deepEqual([ids(recovered.models), recovered.refreshError], [["b"], undefined]);
  });

  it("uses the installed catalogue or definitions until a live list has been read", async () => {
    const { list } = scriptedList([new Error("timed out")]);
    const snapshot = await list.read();
    assert.deepEqual([ids(snapshot.models), snapshot.source, snapshot.refreshError], [["installed-model"], "installed", "timed out"]);
  });

  it("refreshes a stale list for an id it does not have, but not a fresh one, and shares one refresh", async () => {
    const { list, calls, advance } = scriptedList([["a"], ["a", "new"]]);
    assert.equal((await list.find("installed-model")).model?.model.id, "installed-model", "found without a refresh");
    assert.equal(calls(), 0);
    const [first, second] = await Promise.all([list.find("a"), list.read()]);
    assert.equal(first.model?.model.id, "a");
    assert.equal(second.source, "live");
    assert.equal(calls(), 1, "concurrent callers share one refresh");
    assert.equal((await list.find("new")).model, undefined, "a fresh list is not refreshed for a miss");
    advance(MODEL_LIST_TTL_MS);
    assert.equal((await list.find("new")).model?.model.id, "new");
  });
});

/** OpenRouter `/models` entries, as the public API returns them. */
const OPENROUTER_LIST = {
  data: [
    {
      id: "anthropic/claude-sonnet-4.6",
      name: "Anthropic: Claude Sonnet 4.6",
      context_length: 1_000_000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003", input_cache_write: "0.00000375" },
      top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
      supported_parameters: ["reasoning", "tools", "response_format"],
    },
    {
      id: "anthropic/claude-sonnet-4.6:batch",
      name: "Anthropic: Claude Sonnet 4.6 (batch)",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000015", completion: "0.0000075" },
    },
    {
      id: "anthropic/claude-nova-6",
      name: "Anthropic: Claude Nova 6",
      context_length: 1_000_000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: {
        prompt: "0.000002",
        completion: "0.00001",
        input_cache_read: "0.0000002",
        overrides: [{ min_prompt_tokens: 200_000, prompt: "0.000004", completion: "0.000015" }],
      },
      top_provider: { context_length: 1_000_000, max_completion_tokens: 64_000 },
      supported_parameters: ["reasoning", "response_format"],
      reasoning: { mandatory: true, supported_efforts: ["high", "medium", "low"] },
    },
    {
      id: "acme/text-only",
      name: "Acme: Text Only",
      context_length: 32_000,
      architecture: { modality: "text->text" },
      pricing: { prompt: "0.0000001", completion: "0.0000002" },
    },
    {
      id: "openrouter/auto",
      name: "Auto Router",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "-1", completion: "-1" },
    },
    {
      id: "acme/image-maker",
      name: "Acme: Image Maker",
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      pricing: { prompt: "0.000001", completion: "0.00004" },
    },
  ],
};

function byId(entry: ChatProviderModels | undefined): Map<string, ChatModelInfo> {
  assert.ok(entry && "models" in entry, JSON.stringify(entry));
  return new Map(entry.models.map((model) => [model.id, model]));
}

describe("OpenRouter live list", () => {
  function kit(extra: FakeRoute[] = []) {
    const fake = createFakeFetch([{ method: "GET", url: OPENROUTER_MODELS_URL, respond: () => jsonResponse(OPENROUTER_LIST) }, ...extra]);
    return { chat: createChatKit({ providers: [{ name: "router", provider: "openrouter", apiKey: "or-key" }], fetch: fake.fetch }), fake };
  }

  it("lists text-answering models, batch and image-output models left out, models without tools kept", async () => {
    const { chat, fake } = kit();
    const [entry] = await chat.listModels();
    assert.ok(entry && "models" in entry);
    assert.equal(entry.source, "live");
    assert.ok(entry.fetchedAt && !Number.isNaN(Date.parse(entry.fetchedAt)));
    assert.deepEqual(
      entry.models.map((model) => model.id),
      ["anthropic/claude-sonnet-4.6", "anthropic/claude-nova-6", "acme/text-only", "openrouter/auto"],
    );
    assert.equal(fake.calls[0]?.headers.authorization, undefined, "the public list is read without the key");
  });

  it("reports input, documents, schema support, limits, reasoning and the live rate per model", async () => {
    const models = byId((await kit().chat.listModels())[0]);
    assert.deepEqual(models.get("anthropic/claude-sonnet-4.6"), {
      id: "anthropic/claude-sonnet-4.6",
      name: "Anthropic: Claude Sonnet 4.6",
      input: ["text", "image", "file"],
      fileDocuments: true,
      responseSchema: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoning: true,
      rate: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    });
    assert.deepEqual(models.get("acme/text-only")?.input, ["text"]);
    assert.equal(models.get("acme/text-only")?.fileDocuments, false);
    assert.equal(models.get("openrouter/auto")?.rate, undefined, "a -1 price is no rate, never 0");
    assert.deepEqual(models.get("anthropic/claude-nova-6")?.rate, {
      input: 2,
      output: 10,
      cacheRead: 0.2,
      largePrompt: { overPromptTokens: 200_000, input: 4, output: 15, cacheRead: 0.2 },
    });
  });

  it("offers documents only to a model that reads both natively: an image-only model takes images but fails a PDF", async () => {
    // As OpenRouter lists moondream/moondream3-preview: image input, no native file input.
    const list = {
      data: [
        {
          id: "moondream/moondream3-preview",
          name: "Moondream 3 Preview",
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          pricing: { prompt: "0.0000003", completion: "0.0000006" },
        },
        {
          id: "acme/file-reader",
          name: "Acme: File Reader",
          architecture: { input_modalities: ["text", "file"], output_modalities: ["text"] },
          pricing: { prompt: "0.0000003", completion: "0.0000006" },
        },
      ],
    };
    const fake = createFakeFetch([
      { method: "GET", url: OPENROUTER_MODELS_URL, respond: () => jsonResponse(list) },
      {
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        respond: () => sseResponse([completionsChunk({ content: "A cat." }, "stop"), "[DONE]"]),
      },
    ]);
    const chat = createChatKit({ providers: [{ name: "router", provider: "openrouter", apiKey: "or-key" }], fetch: fake.fetch });
    const models = byId((await chat.listModels())[0]);
    const moondream = models.get("moondream/moondream3-preview");
    assert.deepEqual([moondream?.input, moondream?.fileDocuments], [["text", "image"], false]);
    const fileReader = models.get("acme/file-reader");
    assert.deepEqual([fileReader?.input, fileReader?.fileDocuments], [["text", "file"], false], "PDFs, but not images");

    const pdf = testDocument("brief.pdf", "application/pdf", "%PDF-1.7");
    const refused = lastEvent(await collect(chat.runTurn(turn({ model: "moondream/moondream3-preview", documents: [pdf] }))));
    assert.equal(refused.type === "failed" && refused.error.code, "UNSUPPORTED");
    assert.match(refused.type === "failed" ? refused.error.message : "", /does not read PDF files natively/);
    assert.equal(pdf.loads, 0);
    const png = testDocument("cat.png", "image/png", "x");
    const answered = lastEvent(await collect(chat.runTurn(turn({ model: "moondream/moondream3-preview", documents: [png] }))));
    assert.equal(answered.type, "done", "an image goes as a native image part");
    assert.equal(fake.calls.filter((call) => call.method === "POST").length, 1, "only the image turn was sent");
  });

  it("runs a live-only id, routing a new anthropic/* family through OpenAI Completions", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: "https://openrouter.ai/api/v1/chat/completions",
        respond: () =>
          sseResponse([
            completionsChunk({ content: "Hi" }, "stop"),
            completionsUsageChunk({ prompt_tokens: 10, completion_tokens: 2, cost: 0.00004 }),
            "[DONE]",
          ]),
      },
    ]);
    // No listModels() first: the miss refreshes the list.
    const last = lastEvent(await collect(chat.runTurn(turn({ model: "anthropic/claude-nova-6" }))));
    assert.equal(last.type, "done");
    assert.equal(last.type === "done" && last.usage?.costSource, "provider");
    const body = jsonBody(fake.calls.find((call) => call.method === "POST")?.body);
    assert.equal(body.model, "anthropic/claude-nova-6");
    assert.equal("reasoning" in body, false, "mandatory reasoning: no off switch is sent");
    assert.deepEqual(body.plugins, [{ id: "file-parser", pdf: { engine: "native" } }]);
  });

  it("keeps pi-ai's catalogue entry for a known id: its API, compat and thinking fixes", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: /^https:\/\/openrouter\.ai\/api\/v1\/messages\b/,
        respond: () => sseResponse([]),
      },
    ]);
    await chat.listModels();
    await collect(chat.runTurn(turn({ model: "anthropic/claude-sonnet-4.6" })));
    assert.match(fake.calls.at(-1)?.url ?? "", /\/api\/v1\/messages/, "still on Anthropic Messages");
  });

  it("falls back to pi-ai's catalogue when the list cannot be read, and says why", async () => {
    const fake = createFakeFetch([{ method: "GET", url: OPENROUTER_MODELS_URL, respond: () => jsonResponse({ error: { message: "down" } }, 503) }]);
    const chat = createChatKit({ providers: [{ name: "router", provider: "openrouter", apiKey: "k" }], fetch: fake.fetch });
    const [entry] = await chat.listModels();
    assert.ok(entry && "models" in entry);
    assert.equal(entry.source, "installed");
    assert.equal(entry.refreshError, "HTTP 503 from https://openrouter.ai/api/v1/models: down");
    assert.ok(entry.models.some((model) => model.id === "openai/gpt-4o-mini"));
  });

  it("reads the list from a base URL override", async () => {
    const fake = createFakeFetch([{ method: "GET", url: "https://proxy.example.com/openrouter/v1/models", respond: () => jsonResponse(OPENROUTER_LIST) }]);
    const chat = createChatKit({
      providers: [{ name: "router", provider: "openrouter", apiKey: "k", baseUrl: "https://proxy.example.com/openrouter" }],
      fetch: fake.fetch,
    });
    const [entry] = await chat.listModels();
    assert.ok(entry && "models" in entry && entry.source === "live");
  });

  it("maps pricing and reasoning metadata as pi-ai's catalogue generator does", () => {
    assert.deepEqual(openRouterRate({ prompt: "0", completion: "0" }), { periods: [{ input: 0, output: 0 }] }, "a published free rate");
    assert.equal(openRouterRate({ prompt: "0.000001" }), undefined, "no output price: no rate");
    assert.deepEqual(openRouterThinkingLevelMap({ supported_efforts: ["high", "low", "none"] }), {
      off: "none",
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    });
    assert.deepEqual(openRouterThinkingLevelMap({ mandatory: true }), { off: null });
    assert.equal(openRouterThinkingLevelMap(null), undefined);
  });
});

describe("Gemini live list", () => {
  it("lists generateContent models from models.list with the explicit key, across pages", async () => {
    const fake = createFakeFetch([
      {
        method: "GET",
        url: GEMINI_MODELS_URL,
        respond: [
          () =>
            jsonResponse({
              models: [
                { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
                { name: "models/gemini-embedding-2", supportedGenerationMethods: ["embedContent"] },
                { name: "models/gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] },
                { name: "models/imagen-5.0-generate", supportedGenerationMethods: ["predict"] },
              ],
              nextPageToken: "page-2",
            }),
          () =>
            jsonResponse({
              models: [
                {
                  name: "models/gemini-4-argon-preview",
                  displayName: "Gemini 4 Argon Preview",
                  inputTokenLimit: 2_097_152,
                  outputTokenLimit: 131_072,
                  thinking: true,
                  supportedGenerationMethods: ["generateContent"],
                },
                { name: "models/veo-4.0-generate", supportedGenerationMethods: ["generateContent"] },
              ],
            }),
        ],
      },
    ]);
    const chat = createChatKit({ providers: [{ name: "gemini", provider: "google", apiKey: "gemini-key" }], fetch: fake.fetch });
    const models = byId((await chat.listModels())[0]);
    assert.deepEqual([...models.keys()], ["gemini-3.8-flash", "gemini-4-argon-preview"]);
    assert.equal(fake.calls[0]?.headers["x-goog-api-key"], "gemini-key");
    assert.match(fake.calls[1]?.url ?? "", /pageToken=page-2/);
    const flash = models.get("gemini-3.8-flash");
    assert.equal(flash?.fileDocuments, true);
    assert.equal(flash?.contextWindow, 1_048_576, "pi-ai's catalogue entry");
    assert.equal(flash?.rate?.cacheRead, Date.now() < Date.parse("2027-01-01T00:00:00Z") ? 0.075 : 0.15, "the Gemini rate table");
    assert.deepEqual(models.get("gemini-4-argon-preview"), {
      id: "gemini-4-argon-preview",
      name: "Gemini 4 Argon Preview",
      input: ["text"],
      fileDocuments: false,
      responseSchema: true,
      contextWindow: 2_097_152,
      maxOutputTokens: 131_072,
      reasoning: true,
    });
  });
});

describe("KIE and ToAPIs live lists", () => {
  it("keeps only the KIE definitions its two model lists name, matching dotted and dashed ids", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: KIE_CODEX_MODELS_URL, respond: () => jsonResponse({ object: "list", data: [{ id: "gpt-5.6-sol" }, { id: "gpt-9" }] }) },
      { method: "GET", url: KIE_CLAUDE_MODELS_URL, respond: () => jsonResponse({ data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-4-6" }] }) },
    ]);
    const chat = createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "kie-key" }], fetch: fake.fetch });
    const models = byId((await chat.listModels())[0]);
    assert.deepEqual([...models.keys()], ["gpt-5-6-sol", "claude-opus-5-5", "claude-sonnet-4-6"]);
    assert.deepEqual(
      fake.calls.map((call) => call.headers.authorization),
      ["Bearer kie-key", "Bearer kie-key"],
    );
    const opus = models.get("claude-opus-5-5");
    assert.equal(opus?.fileDocuments, false, "KIE document input stays off");
    assert.equal(opus?.responseSchema, false, "an always-thinking Claude without native structured output");
    assert.deepEqual(opus?.rate, { input: 1.6, output: 8 });
    assert.equal(models.get("claude-sonnet-4-6")?.responseSchema, true);
    const turnResult = lastEvent(await collect(chat.runTurn(turn({ provider: "kie", model: "claude-haiku-4-5" }))));
    assert.equal(turnResult.type === "failed" && turnResult.error.code, "UNKNOWN_MODEL", "turns resolve against the live list");
  });

  it("keeps the KIE definitions when a list answers with KIE's error envelope", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: KIE_CODEX_MODELS_URL, respond: () => jsonResponse({ code: 401, msg: "Unauthorized" }) },
      { method: "GET", url: KIE_CLAUDE_MODELS_URL, respond: () => jsonResponse({ data: [] }) },
    ]);
    const chat = createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "bad" }], fetch: fake.fetch });
    const [entry] = await chat.listModels();
    assert.ok(entry && "models" in entry);
    assert.equal(entry.source, "installed");
    assert.match(entry.refreshError ?? "", /code 401 from https:\/\/api\.kie\.ai\/openai\/v1\/models: Unauthorized|lists no model ids/);
    assert.ok(entry.models.some((model) => model.id === "claude-opus-5-5"));
  });

  it("keeps only the ToAPIs definitions /v1/models?type=text names", async () => {
    const fake = createFakeFetch([
      {
        method: "GET",
        url: TOAPIS_MODELS_URL,
        respond: () => jsonResponse({ success: true, object: "list", data: [{ id: "claude-sonnet-4-6" }, { id: "glm-5" }] }),
      },
    ]);
    const chat = createChatKit({ providers: [{ name: "toapis", provider: "toapis", apiKey: "t-key" }], fetch: fake.fetch });
    const models = byId((await chat.listModels())[0]);
    assert.deepEqual([...models.keys()], ["claude-sonnet-4-6"]);
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer t-key");
  });
});

describe("listModels", () => {
  it("lists every provider in configuration order; one failing provider does not hide the others", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: OPENROUTER_MODELS_URL, respond: () => jsonResponse(OPENROUTER_LIST) },
      { method: "GET", url: TOAPIS_MODELS_URL, respond: () => new Response("<html>bad gateway</html>", { status: 502 }) },
    ]);
    const chat = createChatKit({
      providers: [
        { name: "toapis", provider: "toapis", apiKey: "t" },
        { name: "router", provider: "openrouter", apiKey: "o" },
      ],
      fetch: fake.fetch,
    });
    const [toapis, router] = await chat.listModels();
    assert.ok(toapis && "models" in toapis && router && "models" in router);
    assert.deepEqual([toapis.provider, toapis.kind, toapis.source, toapis.refreshError], ["toapis", "toapis", "installed", "HTTP 502 from https://toapis.com/v1/models"]);
    assert.deepEqual([router.provider, router.source], ["router", "live"]);
  });

  it("rejects with the signal's reason when the caller stops waiting", async () => {
    const fake = createFakeFetch([{ method: "GET", url: OPENROUTER_MODELS_URL, respond: () => jsonResponse(OPENROUTER_LIST) }]);
    const chat = createChatKit({ providers: [{ name: "router", provider: "openrouter", apiKey: "o" }], fetch: fake.fetch });
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await assert.rejects(chat.listModels({ signal: controller.signal }), /gone/);
  });
});
