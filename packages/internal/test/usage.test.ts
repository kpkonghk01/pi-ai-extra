import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import { z } from "zod";
import { compactUsage, createOperationContext, option, parseUsageBlock, type ImageModelInfo, type ImageProgressEvent } from "../src/index.ts";
import { createHelperImagesProvider, toPiAiUsage } from "../src/pi-ai/index.ts";
import { dataUrl, PNG_BYTES } from "../src/testing/fake-fetch.ts";

describe("compactUsage", () => {
  it("omits absent fields instead of filling zeros", () => {
    assert.deepEqual(compactUsage({ credits: 12, providerDurationMs: undefined, tokens: { input: 5, output: null } }), {
      credits: 12,
      tokens: { input: 5 },
    });
    assert.deepEqual(compactUsage({ credits: "0", costUsd: "0", billingStatus: "refunded" }), { credits: "0", costUsd: "0", billingStatus: "refunded" });
    assert.equal(compactUsage({ tokens: {} }), undefined);
  });

  it("reports invalid usage blocks as warnings and omits them", () => {
    const events: ImageProgressEvent[] = [];
    const ctx = createOperationContext({ provider: "p", model: "m", onProgress: (event) => events.push(event) });
    assert.equal(parseUsageBlock(ctx, z.object({ credits: z.number() }), { credits: "x" }, "billing"), undefined);
    assert.equal(parseUsageBlock(ctx, z.object({ credits: z.number() }), undefined, "billing"), undefined);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "warning");
  });
});

describe("toPiAiUsage", () => {
  const model = {
    id: "m",
    name: "m",
    api: "x",
    provider: "p",
    baseUrl: "https://example.com",
    input: ["text" as const],
    output: ["image" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  it("follows pi-ai conventions: cached tokens move to cacheRead, reasoning is part of output", () => {
    assert.deepEqual(toPiAiUsage(model, { input: 100, cachedInput: 30, output: 900, reasoning: 50, total: 1050 }), {
      input: 70,
      output: 950,
      cacheRead: 30,
      cacheWrite: 0,
      reasoning: 50,
      totalTokens: 1050,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
  });

  it("returns undefined when no token counts were reported", () => {
    assert.equal(toPiAiUsage(model, undefined), undefined);
    assert.equal(toPiAiUsage(model, { inputImage: 3 }), undefined);
  });
});

describe("ImagesProvider usage", () => {
  const info: ImageModelInfo = {
    id: "img",
    name: "img",
    provider: "p",
    kind: "text-to-image",
    promptMaxLength: null,
    referenceImages: { min: 0, max: 0, acceptedMimeTypes: ["image/png"], maxInlineBytes: 1 },
    aspectRatio: option(["1:1"], null),
    resolution: null,
    background: null,
    outputFormat: null,
    watermark: false,
    notes: [],
  };
  const image = { dataUrl: dataUrl(PNG_BYTES, "image/png"), mimeType: "image/png" as const, byteLength: PNG_BYTES.byteLength, sourceUrl: undefined };

  async function run(usage: unknown) {
    const images = createImagesModels();
    images.setProvider(
      createHelperImagesProvider({
        id: "p",
        name: "P",
        api: "x",
        baseUrl: "https://example.com",
        apiKey: "k",
        models: [info],
        generate: async () => ({ provider: "p", model: "img", taskId: "t", elapsedMs: 1, images: [image], usage }) as never,
      }),
    );
    const model = images.getModel("p", "img");
    assert.ok(model);
    return images.generateImages(model, { input: [{ type: "text", text: "x" }] });
  }

  it("fills AssistantImages.usage only when tokens were reported", async () => {
    assert.equal((await run({ tokens: { input: 10, output: 20, total: 30 } })).usage?.totalTokens, 30);
    assert.equal((await run({ credits: 5 })).usage, undefined);
    assert.equal((await run(undefined)).usage, undefined);
  });
});
