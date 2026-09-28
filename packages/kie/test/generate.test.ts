import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import {
  bytesResponse,
  createFakeFetch,
  dataUrl,
  jsonResponse,
  PNG_BYTES,
  type FakeRoute,
  type RecordedRequest,
} from "@hk01/pi-ai-extra-internal/testing";
import { generateKieImage, isPiAiExtraError, KIE_IMAGE_MODELS, type ImageProgressEvent, type KieImageRequest } from "../src/index.ts";
import { createKieImagesProvider, createKieProvider } from "../src/pi-ai/index.ts";

const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
const CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD_URL = /^https:\/\/api\.kie\.ai\/api\/v1\/jobs\/recordInfo\?taskId=/;
const RESULT_URL = "https://tempfile.aiquickdraw.com/r/result.png";
const FAST_POLL = { initialDelayMs: 1, maxDelayMs: 2 };

const record = (state: string, extra: Record<string, unknown> = {}) => () =>
  jsonResponse({ code: 200, msg: "success", data: { taskId: "task_1", state, ...extra } });
const success = record("success", { resultJson: JSON.stringify({ resultUrls: [RESULT_URL] }) });

function kieRoutes(overrides: Partial<Record<"upload" | "create" | "record" | "result", FakeRoute["respond"]>> = {}): FakeRoute[] {
  return [
    { method: "POST", url: UPLOAD_URL, respond: overrides.upload ?? ((request) => uploaded(request)) },
    { method: "POST", url: CREATE_URL, respond: overrides.create ?? (() => jsonResponse({ code: 200, msg: "success", data: { taskId: "task_1" } })) },
    { method: "GET", url: RECORD_URL, respond: overrides.record ?? [record("waiting"), record("generating"), success] },
    { method: "GET", url: RESULT_URL, respond: overrides.result ?? (() => bytesResponse(PNG_BYTES, "image/png")) },
  ];
}

let uploadCount = 0;
function uploaded(_request: RecordedRequest) {
  uploadCount += 1;
  return jsonResponse({ success: true, code: 200, msg: "ok", data: { downloadUrl: `https://tempfile.redpandaai.co/u/${uploadCount}.png` } });
}

function bodyOf(request: RecordedRequest | undefined): Record<string, unknown> {
  assert.ok(request, "expected request");
  return JSON.parse(String(request.body)) as Record<string, unknown>;
}

const base = { apiKey: "kie-key", poll: FAST_POLL };
const isCode = (code: string) => (error: unknown) => isPiAiExtraError(error) && error.code === code && error.provider === "kie";

describe("generateKieImage", () => {
  it("runs text-to-image: submit, poll the same task, download, return a data URL", async () => {
    const fake = createFakeFetch(kieRoutes());
    const events: ImageProgressEvent[] = [];
    const result = await generateKieImage({
      ...base,
      model: "grok-imagine-image-2-0/text-to-image",
      prompt: "a lighthouse",
      aspectRatio: "16:9",
      fetch: fake.fetch,
      onProgress: (event) => events.push(event),
    });

    assert.deepEqual(bodyOf(fake.callsTo(CREATE_URL)[0]), {
      model: "grok-imagine-image-2-0/text-to-image",
      input: { prompt: "a lighthouse", aspect_ratio: "16:9" },
    });
    assert.equal(fake.callsTo(CREATE_URL)[0]?.headers.authorization, "Bearer kie-key");
    assert.equal(fake.callsTo(UPLOAD_URL).length, 0);
    assert.equal(result.taskId, "task_1");
    assert.equal(result.images[0]?.mimeType, "image/png");
    assert.equal(result.images[0]?.sourceUrl, RESULT_URL);
    assert.ok(result.images[0]?.dataUrl.startsWith("data:image/png;base64,"));
    assert.deepEqual(
      events.map((event) => event.type),
      ["validated", "task_submitted", "task_status", "task_status", "download_started", "completed"],
    );
  });

  it("uploads inline references through KIE only and keeps reference order", async () => {
    uploadCount = 0;
    const fake = createFakeFetch(kieRoutes());
    await generateKieImage({
      ...base,
      model: "nano-banana-2",
      prompt: "combine",
      referenceImages: [dataUrl(PNG_BYTES, "image/png"), "https://cdn.example.com/logo.png", dataUrl(PNG_BYTES, "image/png")],
      resolution: "2K",
      outputFormat: "png",
      fetch: fake.fetch,
    });

    const uploads = fake.callsTo(UPLOAD_URL);
    assert.equal(uploads.length, 2);
    assert.match(String(bodyOf(uploads[0]).base64Data), /^data:image\/png;base64,/);
    const input = bodyOf(fake.callsTo(CREATE_URL)[0]).input as Record<string, unknown>;
    assert.deepEqual((input.image_input as string[]).map((url) => url.replace(/\/\d+\.png$/, "/N.png")), [
      "https://tempfile.redpandaai.co/u/N.png",
      "https://cdn.example.com/logo.png",
      "https://tempfile.redpandaai.co/u/N.png",
    ]);
    assert.equal(input.resolution, "2K");
    assert.equal(input.output_format, "png");
    const hosts = new Set(fake.calls.map((call) => new URL(call.url).host));
    assert.deepEqual([...hosts].sort(), ["api.kie.ai", "kieai.redpandaai.co", "tempfile.aiquickdraw.com"]);
  });

  it("maps GPT Image 2 image-to-image to input_urls", async () => {
    const fake = createFakeFetch(kieRoutes());
    await generateKieImage({
      ...base,
      model: "gpt-image-2-image-to-image",
      prompt: "restyle",
      referenceImages: ["https://cdn.example.com/a.png"],
      aspectRatio: "16:9",
      resolution: "2K",
      fetch: fake.fetch,
    });
    assert.deepEqual(bodyOf(fake.callsTo(CREATE_URL)[0]).input, {
      prompt: "restyle",
      input_urls: ["https://cdn.example.com/a.png"],
      aspect_ratio: "16:9",
      resolution: "2K",
    });
  });

  it("rejects reference-count and parameter violations before any network call", async () => {
    const fake = createFakeFetch(kieRoutes());
    const refs = (count: number) => Array.from({ length: count }, (_, index) => `https://cdn.example.com/${index}.png`);
    const cases: Array<[KieImageRequest, string]> = [
      [{ ...base, model: "grok-imagine-image-2-0/image-edit", prompt: "x", aspectRatio: "auto", referenceImages: refs(6) }, "reference_limit"],
      [{ ...base, model: "gpt-image-2-image-to-image", prompt: "x" }, "reference_limit"],
      [{ ...base, model: "grok-imagine-image-2-0/text-to-image", prompt: "x", aspectRatio: "1:1", referenceImages: refs(1) }, "reference_limit"],
      [{ ...base, model: "gpt-image-2-text-to-image", prompt: "x", aspectRatio: "1:1", resolution: "4K" }, "invalid_request"],
      [{ ...base, model: "gpt-image-2-text-to-image", prompt: "x", resolution: "2K" }, "invalid_request"],
      [{ ...base, model: "gpt-image-2-text-to-image", prompt: "x", aspectRatio: "16:9", resolution: "2K", background: "transparent" }, "invalid_request"],
      [{ ...base, model: "nano-banana-2", prompt: "x", aspect_ratio: "1:1" } as unknown as KieImageRequest, "invalid_request"],
      [{ ...base, model: "nano-banana-pro", prompt: "x" } as unknown as KieImageRequest, "invalid_request"],
      [{ ...base, apiKey: " ", model: "nano-banana-2", prompt: "x" }, "invalid_request"],
    ];
    for (const [request, code] of cases) {
      await assert.rejects(generateKieImage({ ...request, fetch: fake.fetch }), isCode(code), `${request.model} should fail with ${code}`);
    }
    assert.equal(fake.calls.length, 0);
  });

  it("treats undefined-valued options as unset but still rejects misspelled keys with values", async () => {
    const fake = createFakeFetch(kieRoutes());
    const request = { ...base, model: "gpt-image-2-image-to-image", prompt: "x", referenceImages: ["https://cdn.example.com/a.png"], outputFormat: undefined, resolution: undefined };
    await generateKieImage({ ...request, fetch: fake.fetch } as unknown as KieImageRequest);
    assert.deepEqual(bodyOf(fake.callsTo(CREATE_URL)[0]).input, { prompt: "x", input_urls: ["https://cdn.example.com/a.png"] });

    await assert.rejects(
      generateKieImage({ ...request, outputFormat: "png", fetch: fake.fetch } as unknown as KieImageRequest),
      isCode("invalid_request"),
    );
  });

  it("surfaces KIE envelope errors on submission without retrying or falling back", async () => {
    const fake = createFakeFetch(kieRoutes({ create: () => jsonResponse({ code: 402, msg: "Credits insufficient", data: null }) }));
    await assert.rejects(
      generateKieImage({ ...base, model: "nano-banana-2", prompt: "x", fetch: fake.fetch }),
      (error: unknown) => isCode("insufficient_credits")(error) && /Credits insufficient/.test((error as Error).message),
    );
    assert.equal(fake.callsTo(CREATE_URL).length, 1);
    assert.equal(fake.calls.length, 1);
  });

  it("stops at the first failed upload without submitting a task", async () => {
    const fake = createFakeFetch(kieRoutes({ upload: () => jsonResponse({ success: false, code: 500, msg: "storage down" }, 500) }));
    await assert.rejects(
      generateKieImage({ ...base, model: "nano-banana-2", prompt: "x", referenceImages: [dataUrl(PNG_BYTES, "image/png")], fetch: fake.fetch }),
      isCode("http"),
    );
    assert.equal(fake.callsTo(CREATE_URL).length, 0);
    assert.ok(fake.calls.every((call) => call.url === UPLOAD_URL));
  });

  it("reports task failure with KIE's failMsg, failCode and the task id", async () => {
    const fake = createFakeFetch(kieRoutes({ record: record("fail", { failCode: "501", failMsg: "upstream timeout" }) }));
    await assert.rejects(generateKieImage({ ...base, model: "nano-banana-2", prompt: "x", fetch: fake.fetch }), (error: unknown) => {
      return (
        isCode("task_failed")(error) &&
        (error as { taskId?: string }).taskId === "task_1" &&
        (error as { providerCode?: string }).providerCode === "501" &&
        /upstream timeout/.test((error as Error).message)
      );
    });

    const blocked = createFakeFetch(kieRoutes({ record: record("fail", { failCode: "400", failMsg: "The content violates our policy" }) }));
    await assert.rejects(generateKieImage({ ...base, model: "nano-banana-2", prompt: "x", fetch: blocked.fetch }), isCode("content_blocked"));
  });

  it("rejects unknown task states and malformed results instead of guessing", async () => {
    const unknownState = createFakeFetch(kieRoutes({ record: record("paused") }));
    await assert.rejects(generateKieImage({ ...base, model: "nano-banana-2", prompt: "x", fetch: unknownState.fetch }), isCode("invalid_response"));

    const noUrls = createFakeFetch(kieRoutes({ record: record("success", { resultJson: JSON.stringify({ images: [RESULT_URL] }) }) }));
    await assert.rejects(generateKieImage({ ...base, model: "nano-banana-2", prompt: "x", fetch: noUrls.fetch }), isCode("invalid_response"));
  });

  it("cancels while polling and reports the task id", async () => {
    const controller = new AbortController();
    const fake = createFakeFetch(kieRoutes({ record: record("generating") }));
    const pending = generateKieImage({
      ...base,
      poll: { initialDelayMs: 5, maxDelayMs: 5 },
      model: "nano-banana-2",
      prompt: "x",
      fetch: fake.fetch,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.type === "task_status") controller.abort();
      },
    });
    await assert.rejects(pending, (error: unknown) => isCode("aborted")(error) && (error as { taskId?: string }).taskId === "task_1");
  });
});

describe("KIE catalogue and pi-ai adapters", () => {
  it("documents reference limits per model operation", () => {
    const limits = Object.fromEntries(KIE_IMAGE_MODELS.map((model) => [model.id, [model.referenceImages.min, model.referenceImages.max]]));
    assert.deepEqual(limits, {
      "grok-imagine-image-2-0/text-to-image": [0, 0],
      "grok-imagine-image-2-0/image-edit": [1, 5],
      "gpt-image-2-text-to-image": [0, 0],
      "gpt-image-2-image-to-image": [1, 16],
      "nano-banana-2": [0, 14],
    });
  });

  it("generates through pi-ai ImagesModels with validated metadata", async () => {
    const fake = createFakeFetch(kieRoutes());
    const images = createImagesModels();
    images.setProvider(createKieImagesProvider({ apiKey: "kie-key", settings: { poll: FAST_POLL } }));
    const model = images.getModel("kie", "nano-banana-2");
    assert.ok(model);

    const ok = await images.generateImages(model, { input: [{ type: "text", text: "a fox" }] }, { fetch: fake.fetch, metadata: { aspectRatio: "16:9" } });
    assert.equal(ok.stopReason, "stop");
    assert.equal(ok.output[0]?.type, "image");
    assert.equal((bodyOf(fake.callsTo(CREATE_URL)[0]).input as Record<string, unknown>).aspect_ratio, "16:9");

    const bad = await images.generateImages(model, { input: [{ type: "text", text: "a fox" }] }, { fetch: fake.fetch, metadata: { ratio: "16:9" } });
    assert.equal(bad.stopReason, "error");
    assert.match(bad.errorMessage ?? "", /\[kie\/nano-banana-2\].*ratio/);
  });

  it("registers Codex on OpenAI Responses and Claude on Anthropic Messages with KIE base URLs", () => {
    const provider = createKieProvider({ apiKey: "kie-key" });
    const byId = new Map(provider.getModels().map((model) => [model.id, model]));
    assert.equal(byId.get("gpt-5.3-codex")?.api, "openai-responses");
    assert.equal(byId.get("gpt-5.3-codex")?.baseUrl, "https://api.kie.ai/api/v1");
    assert.equal(byId.get("claude-sonnet-5")?.api, "anthropic-messages");
    assert.equal(byId.get("claude-sonnet-5")?.baseUrl, "https://api.kie.ai/claude");
    assert.throws(() => createKieProvider({ apiKey: "" }), /apiKey is required/);
  });
});
