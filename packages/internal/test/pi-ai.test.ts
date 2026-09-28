import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels, type ProviderStreams } from "@earendil-works/pi-ai";
import { option, PiAiExtraError, type ImageModelInfo } from "../src/index.ts";
import {
  bearerAuthStreams,
  buildChatModel,
  createHelperImagesProvider,
  explicitApiKeyAuth,
} from "../src/pi-ai/index.ts";
import { dataUrl, PNG_BYTES } from "../src/testing/fake-fetch.ts";

const MODEL: ImageModelInfo = {
  id: "img-1",
  name: "Image 1",
  provider: "test",
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
  const images = createImagesModels();
  images.setProvider(
    createHelperImagesProvider({
      id: "test",
      name: "Test",
      api: "test-images",
      baseUrl: "https://api.example.com",
      apiKey: "factory-key",
      models: [MODEL],
      settings: { poll: { initialDelayMs: 1 } },
      generate: generate as never,
    }),
  );
  const model = images.getModel("test", "img-1");
  assert.ok(model);
  return { images, model };
}

describe("createHelperImagesProvider", () => {
  it("exposes catalogue limits and converts helper results to pi-ai image content", async () => {
    let seen: Record<string, unknown> | undefined;
    const { images, model } = provider(async (request) => {
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

    const result = await images.generateImages(
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
    const { images, model } = provider(async () => {
      throw new PiAiExtraError("quota exceeded", { provider: "test", model: "img-1", code: "insufficient_credits" });
    });
    const result = await images.generateImages(model, { input: [{ type: "text", text: "x" }] });
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /\[test\/img-1\] quota exceeded/);
  });

  it("rejects metadata that tries to override request fields", async () => {
    const { images, model } = provider(async () => assert.fail("must not run"));
    const result = await images.generateImages(model, { input: [{ type: "text", text: "x" }] }, { metadata: { apiKey: "other" } });
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", /must not set apiKey/);
  });

  it("reports cancellation as stopReason aborted", async () => {
    const controller = new AbortController();
    const { images, model } = provider(async () => {
      controller.abort();
      throw new PiAiExtraError("cancelled", { provider: "test", model: "img-1", code: "aborted" });
    });
    const result = await images.generateImages(model, { input: [{ type: "text", text: "x" }] }, { signal: controller.signal });
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
    const model = buildChatModel("kie", "https://api.kie.ai/claude", { id: "claude-fable-5", protocol: "anthropic-messages" });
    assert.equal(model.provider, "kie");
    assert.equal(model.baseUrl, "https://api.kie.ai/claude");
    assert.equal(model.contextWindow, 1_000_000);
    assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    assert.equal("allowedFallbackModels" in (model.compat ?? {}), false);

    const unknown = buildChatModel("kie", "https://api.kie.ai/api/v1", { id: "gpt-5.4-codex", protocol: "openai-responses" });
    assert.equal(unknown.contextWindow, 400_000);
    assert.equal(unknown.api, "openai-responses");
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
