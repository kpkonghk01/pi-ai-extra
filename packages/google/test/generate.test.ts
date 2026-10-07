import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import {
  bytesResponse,
  createFakeFetch,
  dataUrl,
  GIF_BYTES,
  JPEG_BYTES,
  jsonResponse,
  PNG_BYTES,
  type RecordedRequest,
} from "@hk01/pi-ai-extra-internal/testing";
import { generateGoogleImage, GOOGLE_IMAGE_MODELS, isPiAiExtraError, type GoogleImageRequest } from "../src/index.ts";
import { createGoogleImagesProvider } from "../src/pi-ai/index.ts";

const NANO_BANANA_21_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-nano-banana-2.1:generateContent";
const FLASH_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent";
const PRO_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent";
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

const imageResponse = () =>
  jsonResponse({
    responseId: "resp_1",
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { text: "thinking", thought: true },
            { inlineData: { mimeType: "image/jpeg", data: Buffer.from(JPEG_BYTES).toString("base64") }, thought: true },
            { inlineData: { mimeType: "image/png", data: PNG_B64 } },
          ],
        },
      },
    ],
  });

const bodyOf = (request: RecordedRequest | undefined) => {
  assert.ok(request, "expected request");
  return JSON.parse(String(request.body)) as Record<string, unknown>;
};
const isCode = (code: string) => (error: unknown) => isPiAiExtraError(error) && error.code === code && error.provider === "google";

describe("generateGoogleImage", () => {
  it("sends one generateContent request with imageConfig and returns only final images", async () => {
    const fake = createFakeFetch([{ method: "POST", url: FLASH_URL, respond: imageResponse }]);
    const result = await generateGoogleImage({
      apiKey: "gemini-key",
      model: "gemini-3.1-flash-image",
      prompt: "a poster",
      aspectRatio: "4:5",
      resolution: "2K",
      referenceImages: [dataUrl(PNG_BYTES, "image/png")],
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
      headers: { "User-Agent": "aistudio-build" },
      fetch: fake.fetch,
    });

    const call = fake.calls[0];
    assert.equal(call?.headers["x-goog-api-key"], "gemini-key");
    assert.equal(call?.headers["user-agent"], "aistudio-build");
    assert.deepEqual(bodyOf(call), {
      contents: [{ role: "user", parts: [{ text: "a poster" }, { inlineData: { mimeType: "image/png", data: PNG_B64 } }] }],
      generationConfig: { imageConfig: { aspectRatio: "4:5", imageSize: "2K" } },
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
    });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0]?.mimeType, "image/png");
    assert.equal(result.taskId, "resp_1");
  });

  it("uses the stable endpoint and responseFormat image settings for Nano Banana 2.1", async () => {
    const fake = createFakeFetch([{ method: "POST", url: NANO_BANANA_21_URL, respond: imageResponse }]);
    await generateGoogleImage({
      apiKey: "gemini-key",
      model: "gemini-nano-banana-2.1",
      prompt: "a poster",
      aspectRatio: "16:9",
      resolution: "1K",
      temperature: 0.7,
      fetch: fake.fetch,
    });

    assert.deepEqual(bodyOf(fake.calls[0]), {
      contents: [{ role: "user", parts: [{ text: "a poster" }] }],
      generationConfig: {
        temperature: 0.7,
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: { image: { aspectRatio: "ASPECT_RATIO_SIXTEEN_BY_NINE", imageSize: "IMAGE_SIZE_ONE_K" } },
      },
    });
  });

  it("sends temperature in generationConfig and the system instruction as a text Content", async () => {
    const fake = createFakeFetch([{ method: "POST", url: PRO_URL, respond: imageResponse }]);
    await generateGoogleImage({
      apiKey: "k",
      model: "gemini-3-pro-image",
      prompt: "a poster",
      temperature: 0.7,
      systemInstruction: "Follow the template strictly.",
      fetch: fake.fetch,
    });
    assert.deepEqual(bodyOf(fake.calls[0]), {
      contents: [{ role: "user", parts: [{ text: "a poster" }] }],
      systemInstruction: { parts: [{ text: "Follow the template strictly." }] },
      generationConfig: { temperature: 0.7 },
    });
  });

  it("omits temperature and the system instruction when unset or undefined, and keeps imageConfig beside temperature", async () => {
    const fake = createFakeFetch([{ method: "POST", url: FLASH_URL, respond: imageResponse }]);
    const base = { apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", aspectRatio: "1:1", fetch: fake.fetch } as const;
    await generateGoogleImage({ ...base, temperature: undefined, systemInstruction: undefined });
    await generateGoogleImage({ ...base, temperature: 1.2 });
    const [unset, withTemperature] = fake.calls.map(bodyOf);
    assert.equal("systemInstruction" in (unset ?? {}), false);
    assert.deepEqual(unset?.generationConfig, { imageConfig: { aspectRatio: "1:1" } });
    assert.deepEqual(withTemperature?.generationConfig, { temperature: 1.2, imageConfig: { aspectRatio: "1:1" } });
  });

  it("rejects temperature outside 0-2 and an empty system instruction before any network call", async () => {
    const fake = createFakeFetch([{ method: "POST", url: FLASH_URL, respond: imageResponse }]);
    const base = { apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", fetch: fake.fetch } as const;
    for (const extra of [{ temperature: -0.1 }, { temperature: 2.1 }, { systemInstruction: "  " }]) {
      await assert.rejects(generateGoogleImage({ ...base, ...extra }), isCode("invalid_request"), JSON.stringify(extra));
    }
    await generateGoogleImage({ ...base, temperature: 2 });
    await generateGoogleImage({ ...base, temperature: 0 });
    assert.equal(fake.calls.length, 2);
  });

  it("downloads URL references and sends them inline", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: "https://cdn.example.com/logo.png", respond: () => bytesResponse(PNG_BYTES, "image/png") },
      { method: "POST", url: PRO_URL, respond: imageResponse },
    ]);
    await generateGoogleImage({ apiKey: "k", model: "gemini-3-pro-image", prompt: "p", referenceImages: ["https://cdn.example.com/logo.png"], fetch: fake.fetch });
    const parts = (bodyOf(fake.callsTo(PRO_URL)[0]).contents as Array<{ parts: unknown[] }>)[0]?.parts;
    assert.deepEqual(parts?.[1], { inlineData: { mimeType: "image/png", data: PNG_B64 } });
  });

  it("reports safety blocks and empty results distinctly", async () => {
    const prompt = createFakeFetch([{ method: "POST", url: FLASH_URL, respond: () => jsonResponse({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }) }]);
    await assert.rejects(generateGoogleImage({ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", fetch: prompt.fetch }), isCode("content_blocked"));

    const image = createFakeFetch([{ method: "POST", url: FLASH_URL, respond: () => jsonResponse({ candidates: [{ finishReason: "IMAGE_SAFETY" }] }) }]);
    await assert.rejects(generateGoogleImage({ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", fetch: image.fetch }), isCode("content_blocked"));

    const textOnly = createFakeFetch([
      { method: "POST", url: FLASH_URL, respond: () => jsonResponse({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "I can't draw that." }] } }] }) },
    ]);
    await assert.rejects(generateGoogleImage({ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", fetch: textOnly.fetch }), (error: unknown) => {
      return isCode("no_output")(error) && /I can't draw that/.test((error as Error).message);
    });
  });

  it("reports an invalid API key (HTTP 400 API_KEY_INVALID) as auth", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: FLASH_URL,
        respond: () =>
          jsonResponse(
            { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } },
            400,
          ),
      },
    ]);
    await assert.rejects(generateGoogleImage({ apiKey: "bad", model: "gemini-3.1-flash-image", prompt: "p", fetch: fake.fetch }), isCode("auth"));
  });

  it("maps HTTP errors with Gemini's message and does not retry", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: FLASH_URL, respond: () => jsonResponse({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } }, 429) },
    ]);
    await assert.rejects(generateGoogleImage({ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", fetch: fake.fetch }), (error: unknown) => {
      return isCode("rate_limited")(error) && /Resource exhausted/.test((error as Error).message);
    });
    assert.equal(fake.calls.length, 1);
  });

  it("validates model-specific options and references before any request", async () => {
    const fake = createFakeFetch([]);
    const cases: Array<[GoogleImageRequest, string]> = [
      [{ apiKey: "k", model: "gemini-nano-banana-2.1", prompt: "p", resolution: "512" } as unknown as GoogleImageRequest, "invalid_request"],
      [{ apiKey: "k", model: "gemini-3-pro-image", prompt: "p", aspectRatio: "1:8" } as unknown as GoogleImageRequest, "invalid_request"],
      [{ apiKey: "k", model: "gemini-3-pro-image", prompt: "p", resolution: "512" } as unknown as GoogleImageRequest, "invalid_request"],
      [{ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", referenceImages: Array(15).fill(dataUrl(PNG_BYTES, "image/png")) }, "reference_limit"],
      [{ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", referenceImages: [dataUrl(GIF_BYTES, "image/gif")] }, "invalid_reference"],
      [{ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", headers: { Authorization: "Bearer x" } }, "invalid_request"],
      [{ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", headers: { "x-api-key": "secret" } }, "invalid_request"],
      [{ apiKey: "k", model: "gemini-3.1-flash-image", prompt: "p", headers: { "Proxy-Authorization": "Basic secret" } }, "invalid_request"],
    ];
    for (const [request, code] of cases) {
      await assert.rejects(generateGoogleImage({ ...request, fetch: fake.fetch }), isCode(code), `${code}`);
    }
    assert.equal(fake.calls.length, 0);
  });
});

describe("Google catalogue and pi-ai adapter", () => {
  it("lists all Gemini image models with 14-image limits", () => {
    assert.deepEqual(
      GOOGLE_IMAGE_MODELS.map((model) => [model.id, model.referenceImages.max]),
      [
        ["gemini-nano-banana-2.1", 14],
        ["gemini-3.1-flash-image", 14],
        ["gemini-3-pro-image", 14],
      ],
    );
  });

  it("lists temperature (0-2) and system-instruction support for every model", () => {
    for (const model of GOOGLE_IMAGE_MODELS) {
      assert.deepEqual(model.temperature, { min: 0, max: 2 }, model.id);
      assert.equal(model.systemInstruction, true, model.id);
    }
  });

  it("generates through pi-ai ImagesModels", async () => {
    const fake = createFakeFetch([{ method: "POST", url: FLASH_URL, respond: imageResponse }]);
    const images = createImagesModels();
    images.setProvider(createGoogleImagesProvider({ apiKey: "gemini-key" }));
    const model = images.getModel("google", "gemini-3.1-flash-image");
    assert.ok(model);
    const result = await images.generateImages(model, { input: [{ type: "text", text: "p" }] }, { fetch: fake.fetch, metadata: { aspectRatio: "16:9" } });
    assert.equal(result.stopReason, "stop");
    assert.equal(result.output.length, 1);
  });

  it("passes temperature and the system instruction from pi-ai metadata to Gemini", async () => {
    const fake = createFakeFetch([{ method: "POST", url: PRO_URL, respond: imageResponse }]);
    const images = createImagesModels();
    images.setProvider(createGoogleImagesProvider({ apiKey: "gemini-key" }));
    const model = images.getModel("google", "gemini-3-pro-image");
    assert.ok(model);
    const metadata = { temperature: 0.4, systemInstruction: "Keep the layout." };
    const result = await images.generateImages(model, { input: [{ type: "text", text: "p" }] }, { fetch: fake.fetch, metadata });
    assert.equal(result.stopReason, "stop");
    const body = bodyOf(fake.calls[0]);
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "Keep the layout." }] });
    assert.deepEqual(body.generationConfig, { temperature: 0.4 });
  });
});
