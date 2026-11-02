import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createModels, normalizeContext, type AuthContext, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { GOOGLE_VERTEX_MODELS } from "@earendil-works/pi-ai/providers/google-vertex.models";
import { createFakeFetch, type FakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createGoogleVertexProvider } from "../src/pi-ai/index.ts";

const EXPRESS_STREAM_URL = /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-3\.5-flash:streamGenerateContent\?alt=sse$/;
const NO_AMBIENT_AUTH: AuthContext = { env: async () => undefined, fileExists: async () => false };
const CONTEXT: Context = { systemPrompt: "Be brief.", messages: [{ role: "user", content: "Hello", timestamp: 1 }] };

function sseResponse(chunks: readonly unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const answer = () =>
  sseResponse([
    {
      candidates: [{ content: { role: "model", parts: [{ text: "Hi." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 },
    },
  ]);

/**
 * pi-ai's Vertex adapter rejects a custom fetch, so these tests replace the global fetch the
 * Google GenAI SDK calls, and restore it afterwards.
 */
describe("createGoogleVertexProvider: requests", () => {
  let realFetch: typeof globalThis.fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function network(routes: FakeRoute[]): FakeFetch {
    const fake = createFakeFetch(routes);
    globalThis.fetch = fake.fetch as typeof globalThis.fetch;
    return fake;
  }

  it("sends a turn to the express-mode global endpoint, with the key in x-goog-api-key", async () => {
    const fake = network([{ method: "POST", url: EXPRESS_STREAM_URL, respond: answer }]);
    const models = createModels({ authContext: NO_AMBIENT_AUTH });
    models.setProvider(createGoogleVertexProvider({ apiKey: "vertex-key" }));
    const result = await models.completeSimple(models.getModel("google-vertex", "gemini-3.5-flash")!, CONTEXT);
    assert.equal(result.stopReason, "stop");
    assert.deepEqual(result.content.map((block) => (block.type === "text" ? block.text : block.type)), ["Hi."]);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.headers["x-goog-api-key"], "vertex-key");
  });

  it("turns the 4 adjustable safety filters OFF on every request, and adds the grounding tools when grounding is on", async () => {
    const fake = network([{ method: "POST", url: EXPRESS_STREAM_URL, respond: answer }]);
    for (const grounding of [true, false]) {
      const models = createModels({ authContext: NO_AMBIENT_AUTH });
      models.setProvider(createGoogleVertexProvider({ apiKey: "vertex-key", grounding }));
      await models.completeSimple(models.getModel("google-vertex", "gemini-3.5-flash")!, CONTEXT);
    }
    const [grounded, plain] = fake.calls.map((call) => JSON.parse(String(call.body)) as Record<string, unknown>);
    const safetyOff = [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    ];
    assert.deepEqual(grounded?.safetySettings, safetyOff);
    assert.deepEqual(grounded?.tools, [{ googleSearch: {} }, { urlContext: {} }]);
    assert.deepEqual(plain?.safetySettings, safetyOff);
    assert.equal(plain?.tools, undefined);
  });

  /** Every variable pi-ai's Vertex auth or the Google GenAI SDK reads, set to something the request must not use. */
  const AMBIENT = {
    GOOGLE_CLOUD_API_KEY: "env-cloud-key",
    GOOGLE_API_KEY: "env-google-key",
    GEMINI_API_KEY: "env-gemini-key",
    GOOGLE_CLOUD_PROJECT: "env-project",
    GCLOUD_PROJECT: "env-project",
    GOOGLE_CLOUD_LOCATION: "us-central1",
    GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/adc.json",
    GOOGLE_VERTEX_BASE_URL: "https://vertex.env.example.com",
    GOOGLE_GENAI_USE_VERTEXAI: "false",
  };
  const everythingAmbient: AuthContext = { env: async (name) => AMBIENT[name as keyof typeof AMBIENT], fileExists: async () => true };

  it("never reads environment variables or ADC: not through pi-ai's auth context, the SDK's process.env, or a call without a key", async () => {
    const fake = network([{ method: "POST", url: EXPRESS_STREAM_URL, respond: answer }]);
    await withEnv(AMBIENT, async () => {
      const models = createModels({ authContext: everythingAmbient });
      const vertex = createGoogleVertexProvider({ apiKey: "vertex-key" });
      models.setProvider(vertex);
      const model = models.getModel("google-vertex", "gemini-3.5-flash")!;
      const throughModels = await models.completeSimple(model, CONTEXT);
      // Called on the provider itself, pi-ai resolves no key, and its Vertex adapter would fall back to ADC.
      const direct = await vertex.streamSimple(vertex.getModels().find((entry) => entry.id === model.id)!, normalizeContext(CONTEXT), { project: "option-project", location: "us-east1" } as SimpleStreamOptions).result();
      assert.deepEqual([throughModels.stopReason, direct.stopReason], ["stop", "stop"], direct.errorMessage ?? "");
    });
    assert.deepEqual(fake.calls.map((call) => call.headers["x-goog-api-key"]), ["vertex-key", "vertex-key"]);
  });

  it("rejects a key pi-ai's Vertex adapter would ignore in favour of ADC: blank, its ADC marker, or a <placeholder>", () => {
    for (const apiKey of [" ", "gcp-vertex-credentials", "<GOOGLE_CLOUD_API_KEY>"]) {
      assert.throws(() => createGoogleVertexProvider({ apiKey }), TypeError, apiKey);
    }
  });
});

describe("createGoogleVertexProvider: models", () => {
  const CATALOGUE_IDS = Object.keys(GOOGLE_VERTEX_MODELS);
  const newFlash = { id: "gemini-3.9-flash", catalogueId: "gemini-3.8-flash", rate: { periods: [{ input: 1, output: 5, cacheRead: 0.1 }] } };
  const repricedFlash = { id: "gemini-3.5-flash", rate: { periods: [{ input: 1.25, output: 7.5 }] } };

  it("serves pi-ai's google-vertex catalogue plus the definitions, with no live list; a definition wins over the catalogue entry with its id", () => {
    const vertex = createGoogleVertexProvider({ apiKey: "k", models: [newFlash, repricedFlash] });
    assert.equal(vertex.refreshModels, undefined, "an API key cannot list Agent Platform models");
    assert.deepEqual(vertex.getModels().map((model) => model.id), [...CATALOGUE_IDS, "gemini-3.9-flash"]);
    const added = vertex.getModels().find((model) => model.id === "gemini-3.9-flash")!;
    const source = GOOGLE_VERTEX_MODELS["gemini-3.8-flash"];
    assert.deepEqual(
      [added.name, added.api, added.provider, added.baseUrl, added.input, added.reasoning, added.contextWindow, added.maxTokens, added.thinkingLevelMap],
      ["gemini-3.9-flash", "google-vertex", "google-vertex", "https://aiplatform.googleapis.com/v1", source.input, source.reasoning, source.contextWindow, source.maxTokens, source.thinkingLevelMap],
      "capabilities copied from catalogueId, under its own id and name",
    );
    assert.deepEqual(added.cost, { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
    assert.deepEqual(vertex.chatKit.describe(added).rate, newFlash.rate);
    const repriced = vertex.getModels().find((model) => model.id === "gemini-3.5-flash")!;
    assert.equal(repriced.contextWindow, GOOGLE_VERTEX_MODELS["gemini-3.5-flash"].contextWindow);
    assert.deepEqual(vertex.chatKit.describe(repriced).rate, repricedFlash.rate);
  });

  it("uses the package's Gemini definitions by default: dated schedules where they have one, pi-ai's Vertex list price elsewhere", () => {
    const vertex = createGoogleVertexProvider({ apiKey: "k" });
    assert.deepEqual(vertex.getModels().map((model) => model.id), CATALOGUE_IDS);
    const rateOf = (id: string) => vertex.chatKit.describe(vertex.getModels().find((model) => model.id === id)!).rate;
    assert.deepEqual(rateOf("gemini-3.8-flash")?.periods[1], { from: "2027-01-01", input: 1.5, output: 7.5, cacheRead: 0.15 });
    assert.deepEqual(rateOf("gemini-3.5-flash"), { periods: [{ input: 1.5, output: 9, cacheRead: 0.15 }] });
    const offered = vertex.getModels().filter((model) => vertex.chatKit.offers(model)).map((model) => model.id);
    assert.ok(offered.includes("gemini-3.1-pro-preview-customtools") && !offered.includes("gemini-3.1-flash-lite-image"));
  });

  it("narrows to modelIds, catalogue and definition ids alike, and throws for an unknown id", () => {
    const vertex = createGoogleVertexProvider({ apiKey: "k", models: [newFlash], modelIds: ["gemini-3.9-flash", "gemini-3.1-flash-lite"] });
    assert.deepEqual(vertex.getModels().map((model) => model.id).sort(), ["gemini-3.1-flash-lite", "gemini-3.9-flash"]);
    assert.throws(() => createGoogleVertexProvider({ apiKey: "k", modelIds: ["gemini-3.5-flash", "gemini-9-ultra"] }), /unknown chat model id\(s\) gemini-9-ultra/);
  });

  it("throws for a definition with no catalogue entry to copy capabilities from, or an invalid rate", () => {
    assert.throws(() => createGoogleVertexProvider({ apiKey: "k", models: [{ id: "gemini-4-flash", rate: newFlash.rate }] }), /gemini-4-flash.*catalogueId/);
    assert.throws(() => createGoogleVertexProvider({ apiKey: "k", models: [{ ...newFlash, catalogueId: "gemini-0-flash" }] }), /gemini-0-flash/);
    assert.throws(() => createGoogleVertexProvider({ apiKey: "k", models: [{ id: "gemini-3.9-flash", catalogueId: "gemini-3.8-flash", rate: { periods: [] } }] }), TypeError);
  });
});

/** Runs `run` with the environment variables set, and restores them afterwards. */
async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
