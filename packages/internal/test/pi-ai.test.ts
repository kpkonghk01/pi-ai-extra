import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels, createProvider, type ProviderStreams } from "@earendil-works/pi-ai";
import { option, PiAiExtraError, type ImageModelInfo } from "../src/index.ts";
import {
  bearerAuthStreams,
  buildChatModel,
  createChatProvider,
  explicitApiKeyAuth,
  helperImages,
} from "../src/pi-ai/index.ts";
import { createFakeFetch, dataUrl, PNG_BYTES } from "../src/testing/fake-fetch.ts";

const MODEL: ImageModelInfo = {
  id: "img-1",
  name: "Image 1",
  provider: "test",
  familyId: "img-1",
  familyName: "Image 1",
  operationRole: "unified",
  kind: "text-and-image-to-image",
  promptMaxLength: null,
  referenceImages: { min: 0, max: 3, acceptedMimeTypes: ["image/png"], maxInlineBytes: 1_000 },
  aspectRatio: option(["1:1"], null),
  resolution: null,
  background: null,
  outputFormat: null,
  watermark: false,
  notes: [],
};

function provider(generate: (request: Record<string, unknown>) => Promise<unknown>) {
  const { models, images } = helperImages({
    provider: "test",
    api: "test-images",
    baseUrl: "https://api.example.com",
    apiKey: "factory-key",
    models: [MODEL],
    settings: { poll: { initialDelayMs: 1 } },
    generate: generate as never,
  });
  const collection = createModels();
  collection.setProvider(createProvider({ id: "test", name: "Test", auth: explicitApiKeyAuth("Test", "factory-key"), models, images }));
  const model = collection.getModelOfType("image", "test", "img-1");
  assert.ok(model);
  return { models: collection, model };
}

describe("helperImages", () => {
  it("exposes catalogue limits and converts helper results to pi-ai image content", async () => {
    let seen: Record<string, unknown> | undefined;
    const { models, model } = provider(async (request) => {
      seen = request;
      return {
        provider: "test",
        model: "img-1",
        taskId: "task-9",
        elapsedMs: 1,
        images: [{ dataUrl: dataUrl(PNG_BYTES, "image/png"), mimeType: "image/png", byteLength: PNG_BYTES.byteLength, sourceUrl: undefined }],
      };
    });
    assert.equal(model.inputLimits?.images?.maxPerRequest, 3);

    const result = await models.generateImages(
      model,
      { input: [{ type: "text", text: "a cat" }, { type: "image", mimeType: "image/png", data: "AAAA" }] },
      { metadata: { aspectRatio: "1:1" } },
    );
    assert.equal(result.stopReason, "stop");
    assert.equal(result.responseId, "task-9");
    assert.deepEqual(result.output[0], { type: "image", mimeType: "image/png", data: Buffer.from(PNG_BYTES).toString("base64") });
    assert.equal(seen?.model, "img-1");
    assert.equal(seen?.prompt, "a cat");
    assert.deepEqual(seen?.referenceImages, ["data:image/png;base64,AAAA"]);
    assert.equal(seen?.apiKey, "factory-key");
    assert.equal(seen?.aspectRatio, "1:1");
    assert.deepEqual(seen?.poll, { initialDelayMs: 1 });
  });

  it("returns errors as stopReason error with provider/model context instead of throwing", async () => {
    const { models, model } = provider(async () => {
      throw new PiAiExtraError("quota exceeded", { provider: "test", model: "img-1", code: "insufficient_credits" });
    });
    const result = await models.generateImages(model, { input: [{ type: "text", text: "x" }] });
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /\[test\/img-1\] quota exceeded/);
  });

  it("rejects metadata that tries to override request fields", async () => {
    const { models, model } = provider(async () => assert.fail("must not run"));
    const result = await models.generateImages(model, { input: [{ type: "text", text: "x" }] }, { metadata: { apiKey: "other" } });
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /must not set apiKey/);
  });

  it("serves image models next to chat models from one provider in one Models collection", async () => {
    const { models, images } = helperImages({
      provider: "test",
      api: "test-images",
      baseUrl: "https://api.example.com",
      apiKey: "factory-key",
      models: [MODEL],
      generate: async (request) => ({
        provider: "test",
        model: String(request.model),
        taskId: undefined,
        elapsedMs: 1,
        images: [{ dataUrl: dataUrl(PNG_BYTES, "image/png"), mimeType: "image/png", byteLength: PNG_BYTES.byteLength, sourceUrl: undefined }],
        usage: undefined,
      }),
    });
    const collection = createModels();
    collection.setProvider(
      createChatProvider({
        id: "test",
        name: "Test",
        apiKey: "factory-key",
        baseUrls: { "openai-responses": "https://api.example.com/v1", "anthropic-messages": "https://api.example.com" },
        models: [{ id: "claude-haiku-4-5", protocol: "anthropic-messages" }],
        anthropicAuth: "x-api-key",
        images: { models, images },
      }),
    );
    assert.deepEqual(collection.getModels("test").map((model) => model.id), ["claude-haiku-4-5"]);
    const image = collection.getModelOfType("image", "test", "img-1");
    assert.equal(image?.type, "image");
    assert.equal(image?.api, "test-images");
    assert.equal(collection.getModel("test", "img-1"), undefined);
    assert.ok(image);
    const result = await collection.generateImages(image, { input: [{ type: "text", text: "x" }] });
    assert.equal(result.stopReason, "stop");
    assert.equal(result.provider, "test");
  });

  it("reports cancellation as stopReason aborted", async () => {
    const controller = new AbortController();
    const { models, model } = provider(async () => {
      controller.abort();
      throw new PiAiExtraError("cancelled", { provider: "test", model: "img-1", code: "aborted" });
    });
    const result = await models.generateImages(model, { input: [{ type: "text", text: "x" }] }, { signal: controller.signal });
    assert.equal(result.stopReason, "aborted");
  });
});

describe("chat provider helpers", () => {
  it("requires an explicit key and resolves only that key", async () => {
    assert.throws(() => explicitApiKeyAuth("KIE", ""), /apiKey is required/);
    const auth = explicitApiKeyAuth("KIE", "k-1");
    const resolved = await auth.apiKey?.resolve({ ctx: { env: async () => "ENV-KEY", fileExists: async () => false }, signal: new AbortController().signal });
    assert.equal(resolved?.auth.apiKey, "k-1");
  });

  it("copies built-in capability metadata but strips Anthropic fallback models", () => {
    const model = buildChatModel("kie", "https://api.kie.ai/anthropic", { id: "claude-fable-5", protocol: "anthropic-messages" });
    assert.equal(model.provider, "kie");
    assert.equal(model.baseUrl, "https://api.kie.ai/anthropic");
    assert.equal(model.contextWindow, 1_000_000);
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    assert.equal("allowedFallbackModels" in (model.compat ?? {}), false);

    const unknown = buildChatModel("kie", "https://api.kie.ai/openai/v1", { id: "gpt-5.4-codex", protocol: "openai-responses" });
    assert.equal(unknown.contextWindow, 400_000);
    assert.equal(unknown.api, "openai-responses");
    assert.equal(unknown.thinkingLevelMap, undefined);
  });

  it("copies metadata from catalogueId when the provider spells the id differently, but never its prices", () => {
    const model = buildChatModel("kie", "https://api.kie.ai/openai/v1", { id: "gpt-5-6-sol", catalogueId: "gpt-5.6-sol", protocol: "openai-responses" });
    assert.equal(model.id, "gpt-5-6-sol");
    assert.equal(model.name, "GPT-5.6 Sol");
    assert.equal(model.contextWindow, 272_000);
    assert.equal(model.thinkingLevelMap?.max, "max");
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("sends the key as a Bearer token for Bearer-authenticated Messages endpoints", () => {
    let captured: Record<string, unknown> | undefined;
    const inner = {
      stream: (_model: unknown, _context: unknown, options: Record<string, unknown>) => {
        captured = options;
        return undefined as never;
      },
      streamSimple: () => undefined as never,
    } as unknown as ProviderStreams;
    bearerAuthStreams(inner).stream(undefined as never, undefined as never, { apiKey: "k-2", headers: { "x-extra": "1" } });
    assert.equal(captured?.apiKey, undefined);
    assert.deepEqual(captured?.headers, { "x-extra": "1", Authorization: "Bearer k-2" });
  });
});

describe("chat models on the OpenAI Completions route", () => {
  it("builds a model with its own base URL, its thinking levels and conservative limits", () => {
    const model = buildChatModel("kie", "https://unused.example.com", {
      id: "gemini-3-8-flash",
      protocol: "openai-completions",
      baseUrl: "https://api.kie.ai/gemini-3-8-flash-openai/v1",
      reasoning: true,
      thinkingLevelMap: { off: null, low: "low", high: "high" },
    });
    assert.equal(model.api, "openai-completions");
    assert.equal(model.baseUrl, "https://api.kie.ai/gemini-3-8-flash-openai/v1");
    assert.equal(model.contextWindow, 128_000);
    assert.equal(model.maxTokens, 16_384);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.deepEqual(model.thinkingLevelMap, { off: null, low: "low", high: "high" });
  });

  it("needs a base URL, from the model or from the provider, and names the model that lacks one", () => {
    const options = { id: "test", name: "Test", apiKey: "k", anthropicAuth: "x-api-key" as const };
    assert.throws(
      () => createChatProvider({ ...options, baseUrls: {}, models: [{ id: "m-1", protocol: "openai-completions" }] }),
      /chat model m-1.*openai-completions.*base URL/,
    );
    const provided = createChatProvider({ ...options, baseUrls: { "openai-completions": "https://api.example.com/v1" }, models: [{ id: "m-1", protocol: "openai-completions" }] });
    assert.equal(provided.getModels()[0]?.baseUrl, "https://api.example.com/v1");
    const own = createChatProvider({ ...options, baseUrls: {}, models: [{ id: "m-2", protocol: "openai-completions", baseUrl: "https://own.example.com/v1" }] });
    assert.equal(own.getModels()[0]?.baseUrl, "https://own.example.com/v1");
  });

  it("serves a completions model through pi-ai's OpenAI Completions adapter, at the model's own base URL", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"pong"},"index":0}],"created":1,"id":"c-1","object":"chat.completion.chunk"}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"created":1,"id":"c-2","object":"chat.completion.chunk"}',
      "data: [DONE]",
    ].join("\n\n") + "\n\n";
    const fake = createFakeFetch([
      { method: "POST", url: "https://own.example.com/v1/chat/completions", respond: () => new Response(sse, { headers: { "content-type": "text/event-stream" } }) },
    ]);
    const chat = createChatProvider({
      id: "test",
      name: "Test",
      apiKey: "factory-key",
      baseUrls: {},
      models: [{ id: "m-2", protocol: "openai-completions", baseUrl: "https://own.example.com/v1" }],
      anthropicAuth: "x-api-key",
      fetch: fake.fetch,
    });
    const collection = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    collection.setProvider(chat);
    const model = chat.getModels()[0]!;
    const message = await collection.completeSimple(model, { messages: [{ role: "user", content: "ping", timestamp: 1 }] }, { maxRetries: 0 });
    assert.equal(message.stopReason, "stop");
    assert.deepEqual(message.content.map((block) => (block.type === "text" ? block.text : block.type)), ["pong"]);
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer factory-key");
  });
});
