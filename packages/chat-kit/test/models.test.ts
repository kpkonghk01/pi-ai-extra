import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeFetch, jsonResponse, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit, type ChatModelInfo, type ChatProviderModels } from "../src/index.ts";
import { TurnFailure } from "../src/errors.ts";
import { createModelList, FAILED_REFRESH_RETRY_MS, MODEL_LIST_TTL_MS, type ListedModel } from "../src/models/list.ts";
import { openRouterRate, openRouterThinkingLevelMap } from "../src/models/openrouter.ts";
import { prepareTurn } from "../src/prepare.ts";
import { createProviderRegistry } from "../src/registry.ts";
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

  it("reads the live list before a new list's first lookup, and resolves against it", async () => {
    const { list, calls } = scriptedList([["a"]]);
    const first = await list.find("installed-model");
    assert.equal(calls(), 1, "the first lookup read the live list");
    assert.equal(first.model, undefined, "an id only the installed list has is not found");
    assert.equal(first.snapshot.source, "live");
    assert.equal((await list.find("a")).model?.model.id, "a");
    assert.equal(calls(), 1, "a fresh list is not read again");
  });

  it("reads a stale list again before a lookup, even for an id it has: a dropped model is gone, an added one found", async () => {
    const { list, calls, advance } = scriptedList([["a", "b"], ["b", "c"]]);
    assert.equal((await list.find("a")).model?.model.id, "a");
    advance(MODEL_LIST_TTL_MS - 1);
    assert.equal((await list.find("a")).model?.model.id, "a");
    assert.equal((await list.find("c")).model, undefined, "a fresh list is not read again, even for a miss");
    assert.equal(calls(), 1);
    advance(1);
    const stale = await list.find("a");
    assert.equal(calls(), 2, "the stale list was read again before the lookup");
    assert.equal(stale.model, undefined, "a model the live list dropped is not found");
    assert.equal((await list.find("c")).model?.model.id, "c");
  });

  it("resolves against the last good list when a refresh fails, and reads it again after a minute", async () => {
    const { list, calls, advance } = scriptedList([["a"], new Error("HTTP 503"), ["b"]]);
    await list.find("a");
    advance(MODEL_LIST_TTL_MS);
    const failed = await list.find("a");
    assert.deepEqual([failed.model?.model.id, failed.snapshot.source, failed.snapshot.refreshError], ["a", "live", "HTTP 503"]);
    advance(FAILED_REFRESH_RETRY_MS - 1);
    assert.equal((await list.find("b")).model, undefined);
    assert.equal(calls(), 2, "no retry within a minute of a failure");
    advance(1);
    assert.equal((await list.find("b")).model?.model.id, "b");
    assert.equal(calls(), 3);
  });

  it("resolves against the installed list when no live list has been read, until one is", async () => {
    const { list, calls, advance } = scriptedList([new Error("timed out"), ["a"]]);
    const found = await list.find("installed-model");
    assert.deepEqual([found.model?.model.id, found.snapshot.source, found.snapshot.refreshError], ["installed-model", "installed", "timed out"]);
    assert.equal(calls(), 1);
    advance(FAILED_REFRESH_RETRY_MS);
    const live = await list.find("installed-model");
    assert.deepEqual([live.model, live.snapshot.source], [undefined, "live"], "once a live list is read, it decides");
  });

  it("shares one refresh between concurrent lookups and listings", async () => {
    const { list, calls } = scriptedList([["a"]]);
    const [first, listed, missing] = await Promise.all([list.find("a"), list.read(), list.find("installed-model")]);
    assert.equal(first.model?.model.id, "a");
    assert.equal(listed.source, "live");
    assert.equal(missing.model, undefined);
    assert.equal(calls(), 1);
  });
});

describe("turns resolve against the live list", () => {
  const KIE_LISTS: FakeRoute[] = [
    { method: "GET", url: KIE_CODEX_MODELS_URL, respond: () => jsonResponse({ data: [{ id: "gpt-5-6-sol" }] }) },
    { method: "GET", url: KIE_CLAUDE_MODELS_URL, respond: () => jsonResponse({ data: [{ id: "claude-opus-5-5" }] }) },
  ];

  it("reads it before a new kit's first turn: a model the live list dropped fails with UNKNOWN_MODEL, and nothing is sent", async () => {
    const fake = createFakeFetch(KIE_LISTS);
    const chat = createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "kie-key" }], fetch: fake.fetch });
    // claude-haiku-4-5 is a package definition, so it is in the installed list.
    const last = lastEvent(await collect(chat.runTurn(turn({ provider: "kie", model: "claude-haiku-4-5" }))));
    assert.equal(last.type === "failed" && last.error.code, "UNKNOWN_MODEL");
    assert.deepEqual(
      fake.calls.map((call) => `${call.method} ${call.url}`),
      [`GET ${KIE_CODEX_MODELS_URL}`, `GET ${KIE_CLAUDE_MODELS_URL}`],
    );
  });

  it("reads a stale list again before a turn, so a model dropped since the last read fails with UNKNOWN_MODEL", async () => {
    let clock = Date.parse("2026-10-20T00:00:00Z");
    const fake = createFakeFetch([
      { method: "GET", url: KIE_CODEX_MODELS_URL, respond: () => jsonResponse({ data: [{ id: "gpt-5-6-sol" }] }) },
      {
        method: "GET",
        url: KIE_CLAUDE_MODELS_URL,
        respond: [() => jsonResponse({ data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-4-5" }] }), () => jsonResponse({ data: [{ id: "claude-opus-5-5" }] })],
      },
    ]);
    const registry = createProviderRegistry([{ name: "kie", provider: "kie", apiKey: "kie-key" }], { fetch: fake.fetch, now: () => clock });
    const prepare = () =>
      prepareTurn(registry, turn({ provider: "kie", model: "claude-haiku-4-5" }), { provider: "kie", model: "claude-haiku-4-5" }, new AbortController().signal);
    assert.equal((await prepare()).model.id, "claude-haiku-4-5");
    clock += MODEL_LIST_TTL_MS - 1;
    assert.equal((await prepare()).model.id, "claude-haiku-4-5", "a fresh list is not read again");
    assert.equal(fake.calls.length, 2);
    clock += 1;
    await assert.rejects(prepare(), (error: unknown) => error instanceof TurnFailure && error.code === "UNKNOWN_MODEL");
    assert.equal(fake.calls.length, 4, "the stale list was read again before the turn");
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

describe("Gemini chat-only filter", () => {
  /** pi-ai's Gemini catalogue ids that are not plain text chat models (embedding, Imagen, Veo and TTS ones come from the live list). */
  const NOT_CHAT = [
    "deep-research-max-preview-04-2026",
    "deep-research-preview-04-2026",
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-3.1-flash-lite-image",
    "gemini-3.1-flash-live-preview",
  ];

  it("leaves Live, computer use, image-output and Deep Research models out of the live list", async () => {
    const generate = ["generateContent"];
    const fake = createFakeFetch([
      {
        method: "GET",
        url: GEMINI_MODELS_URL,
        respond: () =>
          jsonResponse({
            models: [
              ...NOT_CHAT.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: generate })),
              { name: "models/gemini-live-2.5-flash-preview", supportedGenerationMethods: generate },
              { name: "models/gemini-3-pro-image-preview", supportedGenerationMethods: generate },
              { name: "models/gemini-2.0-flash-preview-image-generation", supportedGenerationMethods: generate },
              { name: "models/gemini-3.8-flash", supportedGenerationMethods: generate },
              { name: "models/gemini-3.1-pro-preview-customtools", supportedGenerationMethods: generate },
              { name: "models/gemma-4-31b-it", supportedGenerationMethods: generate },
            ],
          }),
      },
    ]);
    const chat = createChatKit({ providers: [{ name: "gemini", provider: "google", apiKey: "gemini-key" }], fetch: fake.fetch });
    const models = byId((await chat.listModels())[0]);
    assert.deepEqual([...models.keys()], ["gemini-3.8-flash", "gemini-3.1-pro-preview-customtools", "gemma-4-31b-it"]);
  });

  it("filters the installed catalogue the same way when models.list fails (a region block, for example)", async () => {
    const fake = createFakeFetch([
      {
        method: "GET",
        url: GEMINI_MODELS_URL,
        respond: () => jsonResponse({ error: { code: 400, message: "User location is not supported for the API use." } }, 400),
      },
    ]);
    const chat = createChatKit({ providers: [{ name: "gemini", provider: "google", apiKey: "gemini-key" }], fetch: fake.fetch });
    const [entry] = await chat.listModels();
    assert.ok(entry && "models" in entry);
    assert.equal(entry.source, "installed");
    assert.match(entry.refreshError ?? "", /HTTP 400 .*User location is not supported/);
    const listedIds = entry.models.map((model) => model.id);
    assert.ok(listedIds.includes("gemini-3.8-flash"));
    for (const id of NOT_CHAT) assert.ok(!listedIds.includes(id), id);
    const turnResult = lastEvent(await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.1-flash-live-preview" }))));
    assert.equal(turnResult.type === "failed" && turnResult.error.code, "UNKNOWN_MODEL", "turns resolve against the filtered list");
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
    assert.equal(opus?.responseSchema, true, "an always-thinking Claude, through KIE's native structured output");
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
