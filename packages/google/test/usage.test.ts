import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import { createFakeFetch, jsonResponse, PNG_BYTES } from "@hk01/pi-ai-extra-internal/testing";
import { generateGoogleImage } from "../src/index.ts";
import { createGoogleImagesProvider } from "../src/pi-ai/index.ts";

const URL_FLASH = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent";

const withUsage = (usageMetadata: unknown) => () =>
  jsonResponse({
    candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from(PNG_BYTES).toString("base64") } }] } }],
    ...(usageMetadata === undefined ? {} : { usageMetadata }),
  });

const FULL = {
  promptTokenCount: 1_300,
  cachedContentTokenCount: 200,
  candidatesTokenCount: 1_120,
  thoughtsTokenCount: 400,
  totalTokenCount: 2_820,
  promptTokensDetails: [
    { modality: "TEXT", tokenCount: 40 },
    { modality: "IMAGE", tokenCount: 1_260 },
  ],
  candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1_120 }],
};

const run = async (usageMetadata: unknown) => {
  const fake = createFakeFetch([{ method: "POST", url: URL_FLASH, respond: withUsage(usageMetadata) }]);
  return generateGoogleImage({ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", fetch: fake.fetch });
};

describe("Gemini usage", () => {
  it("maps usageMetadata including modality details and thoughts", async () => {
    assert.deepEqual((await run(FULL)).usage, {
      tokens: {
        input: 1_300,
        output: 1_120,
        total: 2_820,
        inputText: 40,
        inputImage: 1_260,
        cachedInput: 200,
        outputImage: 1_120,
        reasoning: 400,
      },
    });
  });

  it("omits counters Gemini leaves out rather than filling zeros", async () => {
    assert.deepEqual((await run({ promptTokenCount: 10, totalTokenCount: 10, promptTokensDetails: [{ modality: "TEXT" }] })).usage, {
      tokens: { input: 10, total: 10 },
    });
    assert.equal((await run(undefined)).usage, undefined);
  });

  it("fills pi-ai usage with pi-ai's Gemini conventions", async () => {
    const fake = createFakeFetch([{ method: "POST", url: URL_FLASH, respond: withUsage(FULL) }]);
    const images = createImagesModels();
    images.setProvider(createGoogleImagesProvider({ apiKey: "k" }));
    const model = images.getModel("google", "gemini-3.1-flash-image");
    assert.ok(model);
    const result = await images.generateImages(model, { input: [{ type: "text", text: "p" }] }, { fetch: fake.fetch });
    assert.deepEqual(
      {
        input: result.usage?.input,
        output: result.usage?.output,
        cacheRead: result.usage?.cacheRead,
        reasoning: result.usage?.reasoning,
        totalTokens: result.usage?.totalTokens,
      },
      { input: 1_100, output: 1_520, cacheRead: 200, reasoning: 400, totalTokens: 2_820 },
    );
  });
});
