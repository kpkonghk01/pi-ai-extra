import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import {
  bytesResponse,
  createFakeFetch,
  dataUrl,
  GIF_BYTES,
  jsonResponse,
  PNG_BYTES,
  type FakeRoute,
  type RecordedRequest,
} from "@hk01/pi-ai-extra-internal/testing";
import { generateToapisImage, isPiAiExtraError, TOAPIS_IMAGE_MODELS, type ToapisImageRequest } from "../src/index.ts";
import { createToapisImagesProvider, createToapisProvider } from "../src/pi-ai/index.ts";

const HOST = "https://toapis.com";
const UPLOAD_URL = `${HOST}/v1/uploads/images`;
const SUBMIT_URL = `${HOST}/v1/images/generations`;
const STATUS_URL = /^https:\/\/toapis\.com\/v1\/images\/generations\/tsk_1$/;
const RESULT_URL = "https://files.toapis.com/generated/1.png";
const FAST_POLL = { initialDelayMs: 1, maxDelayMs: 2 };

const status = (value: string, extra: Record<string, unknown> = {}) => () =>
  jsonResponse({ id: "tsk_1", object: "generation.task", status: value, ...extra });
const completed = status("completed", { result: { type: "image", data: [{ url: RESULT_URL }] } });

let uploads = 0;
function routes(overrides: Partial<Record<"upload" | "submit" | "status" | "result", FakeRoute["respond"]>> = {}): FakeRoute[] {
  return [
    {
      method: "POST",
      url: UPLOAD_URL,
      respond:
        overrides.upload ??
        (() => {
          uploads += 1;
          return jsonResponse({ success: true, message: "", data: { id: `up_${uploads}`, url: `https://files.toapis.com/uploads/${uploads}.png` } });
        }),
    },
    { method: "POST", url: SUBMIT_URL, respond: overrides.submit ?? (() => jsonResponse({ id: "tsk_1", status: "pending" })) },
    { method: "GET", url: STATUS_URL, respond: overrides.status ?? [status("queued"), status("in_progress"), completed] },
    { method: "GET", url: RESULT_URL, respond: overrides.result ?? (() => bytesResponse(PNG_BYTES, "image/png")) },
  ];
}

const bodyOf = (request: RecordedRequest | undefined) => {
  assert.ok(request, "expected request");
  return JSON.parse(String(request.body)) as Record<string, unknown>;
};
const base = { apiKey: "toapis-key", poll: FAST_POLL };
const isCode = (code: string) => (error: unknown) => isPiAiExtraError(error) && error.code === code && error.provider === "toapis";

describe("generateToapisImage", () => {
  it("builds provider-native bodies per model", async () => {
    const cases: Array<[ToapisImageRequest, Record<string, unknown>]> = [
      [
        { ...base, model: "gpt-image-2", prompt: "p", aspectRatio: "16:9", resolution: "2K", background: "transparent", referenceImages: ["https://cdn.example.com/a.png"] },
        { model: "gpt-image-2", prompt: "p", n: 1, size: "16:9", resolution: "2k", background: "transparent", response_format: "url", reference_images: ["https://cdn.example.com/a.png"] },
      ],
      [
        { ...base, model: "gpt-image-2.5-sunburst", prompt: "p", aspectRatio: "1:1", resolution: "4K" },
        { model: "gpt-image-2.5-sunburst", prompt: "p", n: 1, size: "1:1", resolution: "4K" },
      ],
      [
        { ...base, model: "gemini-3.1-flash-image-preview", prompt: "p", aspectRatio: "4:5", resolution: "2K", referenceImages: ["https://cdn.example.com/a.png"] },
        { model: "gemini-3.1-flash-image-preview", prompt: "p", n: 1, size: "4:5", image_urls: ["https://cdn.example.com/a.png"], metadata: { resolution: "2K" } },
      ],
      [
        { ...base, model: "doubao-seedream-5-0-pro", prompt: "p", resolution: "1K", watermark: false },
        { model: "doubao-seedream-5-0-pro", prompt: "p", n: 1, metadata: { resolution: "1K", watermark: false } },
      ],
    ];
    for (const [request, expected] of cases) {
      const fake = createFakeFetch(routes());
      const result = await generateToapisImage({ ...request, fetch: fake.fetch });
      assert.deepEqual(bodyOf(fake.callsTo(SUBMIT_URL)[0]), expected, request.model);
      assert.equal(fake.callsTo(SUBMIT_URL)[0]?.headers.authorization, "Bearer toapis-key");
      assert.equal(result.taskId, "tsk_1");
      assert.equal(result.images[0]?.mimeType, "image/png");
    }
  });

  it("uploads inline references as multipart through ToAPIs only, preserving order", async () => {
    uploads = 0;
    const fake = createFakeFetch(routes());
    await generateToapisImage({
      ...base,
      model: "gpt-image-2",
      prompt: "p",
      referenceImages: [dataUrl(PNG_BYTES, "image/png"), "https://cdn.example.com/b.png", dataUrl(PNG_BYTES, "image/png")],
      fetch: fake.fetch,
    });
    const uploadCalls = fake.callsTo(UPLOAD_URL);
    assert.equal(uploadCalls.length, 2);
    const file = (uploadCalls[0]?.body as FormData).get("file");
    assert.ok(file instanceof Blob);
    assert.equal(file.type, "image/png");
    const refs = bodyOf(fake.callsTo(SUBMIT_URL)[0]).reference_images as string[];
    assert.equal(refs[1], "https://cdn.example.com/b.png");
    assert.ok(refs[0]?.startsWith("https://files.toapis.com/uploads/") && refs[2]?.startsWith("https://files.toapis.com/uploads/"));
    assert.ok(fake.calls.every((call) => new URL(call.url).host.endsWith("toapis.com")));
  });

  it("rejects limit and parameter violations before any network call", async () => {
    const fake = createFakeFetch(routes());
    const refs = (count: number) => Array.from({ length: count }, (_, index) => `https://cdn.example.com/${index}.png`);
    const cases: Array<[ToapisImageRequest, string]> = [
      [{ ...base, model: "gemini-3.1-flash-image-preview", prompt: "p", referenceImages: refs(7) }, "reference_limit"],
      [{ ...base, model: "gpt-image-2", prompt: "p", referenceImages: refs(7) }, "reference_limit"],
      [{ ...base, model: "doubao-seedream-5-0-pro", prompt: "p", referenceImages: refs(11) }, "reference_limit"],
      [{ ...base, model: "doubao-seedream-5-0-pro", prompt: "p", referenceImages: [dataUrl(GIF_BYTES, "image/gif")] }, "invalid_reference"],
      [{ ...base, model: "doubao-seedream-5-0-pro", prompt: "p", resolution: "4K" } as unknown as ToapisImageRequest, "invalid_request"],
      [{ ...base, model: "gpt-image-2", prompt: "p", background: "opaque" } as unknown as ToapisImageRequest, "invalid_request"],
      [{ ...base, model: "gemini-2.5-flash-image-preview", prompt: "p" } as unknown as ToapisImageRequest, "invalid_request"],
    ];
    for (const [request, code] of cases) {
      await assert.rejects(generateToapisImage({ ...request, fetch: fake.fetch }), isCode(code), `${request.model} → ${code}`);
    }
    assert.equal(fake.calls.length, 0);
  });

  it("does not list or accept temperature or a system instruction (undocumented by ToAPIs)", async () => {
    for (const model of TOAPIS_IMAGE_MODELS) {
      assert.equal(model.temperature, undefined, model.id);
      assert.equal(model.systemInstruction, undefined, model.id);
    }
    const fake = createFakeFetch(routes());
    for (const extra of [{ temperature: 0.7 }, { systemInstruction: "rules" }]) {
      const request = { ...base, model: "gemini-3.1-flash-image-preview", prompt: "p", ...extra } as unknown as ToapisImageRequest;
      await assert.rejects(generateToapisImage({ ...request, fetch: fake.fetch }), isCode("invalid_request"), JSON.stringify(extra));
    }
    assert.equal(fake.calls.length, 0);
  });

  it("imposes no package-side reference cap on GPT Image 2.5 (undocumented)", async () => {
    const fake = createFakeFetch(routes());
    const referenceImages = Array.from({ length: 20 }, (_, index) => `https://cdn.example.com/${index}.png`);
    await generateToapisImage({ ...base, model: "gpt-image-2.5-flare", prompt: "p", referenceImages, fetch: fake.fetch });
    assert.equal((bodyOf(fake.callsTo(SUBMIT_URL)[0]).reference_images as string[]).length, 20);
  });

  it("surfaces submission errors directly: no retry, no other model, no other host", async () => {
    const fake = createFakeFetch(routes({ submit: () => jsonResponse({ error: { code: "circuit_broken", message: "所有渠道当前不可用" } }, 503) }));
    await assert.rejects(
      generateToapisImage({ ...base, model: "gpt-image-2.5-flare", prompt: "p", fetch: fake.fetch }),
      (error: unknown) => isCode("http")(error) && (error as { status?: number }).status === 503 && /所有渠道当前不可用/.test((error as Error).message),
    );
    assert.equal(fake.calls.length, 1);
  });

  it("reports failed tasks, flags safety blocks, and rejects unknown statuses", async () => {
    const failed = createFakeFetch(routes({ status: status("failed", { error: { code: "generation_failed", message: "upstream returned status 422" } }) }));
    await assert.rejects(generateToapisImage({ ...base, model: "gpt-image-2", prompt: "p", fetch: failed.fetch }), (error: unknown) => {
      return isCode("task_failed")(error) && (error as { taskId?: string }).taskId === "tsk_1" && (error as { providerCode?: string }).providerCode === "generation_failed";
    });

    const blocked = createFakeFetch(routes({ status: status("failed", { error: { code: "content_policy", message: "blocked by safety review" } }) }));
    await assert.rejects(generateToapisImage({ ...base, model: "gpt-image-2", prompt: "p", fetch: blocked.fetch }), isCode("content_blocked"));

    const unknown = createFakeFetch(routes({ status: status("succeeded") }));
    await assert.rejects(generateToapisImage({ ...base, model: "gpt-image-2", prompt: "p", fetch: unknown.fetch }), isCode("invalid_response"));
  });

  it("uses an explicitly chosen host for every request", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: "https://toapis.cn/v1/images/generations", respond: () => jsonResponse({ id: "tsk_1" }) },
      { method: "GET", url: "https://toapis.cn/v1/images/generations/tsk_1", respond: completed },
      { method: "GET", url: RESULT_URL, respond: () => bytesResponse(PNG_BYTES, "image/png") },
    ]);
    await generateToapisImage({ ...base, baseUrl: "https://toapis.cn/", model: "gpt-image-2", prompt: "p", fetch: fake.fetch });
    assert.equal(fake.calls.length, 3);
  });
});

describe("ToAPIs catalogue and pi-ai adapters", () => {
  it("exposes Gemini 3.1 (not 2.5) and the documented limits", () => {
    const limits = Object.fromEntries(TOAPIS_IMAGE_MODELS.map((model) => [model.id, model.referenceImages.max]));
    assert.deepEqual(limits, {
      "gemini-3.1-flash-image-preview": 6,
      "gpt-image-2": 6,
      "gpt-image-2.5-flare": null,
      "gpt-image-2.5-sunburst": null,
      "doubao-seedream-5-0-pro": 10,
    });
  });

  it("declares each ToAPIs operation as its own unified family", () => {
    for (const model of TOAPIS_IMAGE_MODELS) {
      assert.equal(model.familyId, model.id);
      assert.equal(model.familyName, model.name);
      assert.equal(model.operationRole, "unified");
    }
  });

  it("generates through pi-ai ImagesModels", async () => {
    const fake = createFakeFetch(routes());
    const images = createImagesModels();
    images.setProvider(createToapisImagesProvider({ apiKey: "toapis-key", settings: { poll: FAST_POLL } }));
    const model = images.getModel("toapis", "doubao-seedream-5-0-pro");
    assert.ok(model);
    const result = await images.generateImages(model, { input: [{ type: "text", text: "panda" }] }, { fetch: fake.fetch, metadata: { resolution: "1K" } });
    assert.equal(result.stopReason, "stop");
    assert.equal(result.responseId, "tsk_1");
  });

  it("registers Codex on Responses (host/v1) and Claude on Messages (host)", () => {
    const provider = createToapisProvider({ apiKey: "toapis-key" });
    const byId = new Map(provider.getModels().map((model) => [model.id, model]));
    assert.equal(byId.get("gpt-5.3-codex")?.baseUrl, "https://toapis.com/v1");
    assert.equal(byId.get("claude-sonnet-4-6")?.baseUrl, "https://toapis.com");
    assert.equal(byId.get("claude-sonnet-4-6")?.api, "anthropic-messages");
  });
});
