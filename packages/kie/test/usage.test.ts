import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import { bytesResponse, createFakeFetch, jsonResponse, PNG_BYTES, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { generateKieImage, getKieTask, isPiAiExtraError, type ImageProgressEvent } from "../src/index.ts";
import { createKieImagesProvider } from "../src/pi-ai/index.ts";

const CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD_URL = /^https:\/\/api\.kie\.ai\/api\/v1\/jobs\/recordInfo\?taskId=task_1$/;
const RESULT_URL = "https://tempfile.aiquickdraw.com/r/result.png";

const record = (data: Record<string, unknown>) => () =>
  jsonResponse({ code: 200, msg: "success", data: { taskId: "task_1", model: "nano-banana-2", ...data } });
const success = (extra: Record<string, unknown>) =>
  record({ state: "success", resultJson: JSON.stringify({ resultUrls: [RESULT_URL] }), ...extra });

function routes(recordResponder: FakeRoute["respond"]): FakeRoute[] {
  return [
    { method: "POST", url: CREATE_URL, respond: () => jsonResponse({ code: 200, msg: "success", data: { taskId: "task_1" } }) },
    { method: "GET", url: RECORD_URL, respond: recordResponder },
    { method: "GET", url: RESULT_URL, respond: () => bytesResponse(PNG_BYTES, "image/png") },
  ];
}

const request = { apiKey: "kie-key", model: "nano-banana-2" as const, prompt: "x", poll: { initialDelayMs: 1, maxDelayMs: 1 } };

describe("KIE usage", () => {
  it("returns creditsConsumed and costTime (milliseconds per recordInfo docs)", async () => {
    const fake = createFakeFetch(routes([record({ state: "generating" }), success({ creditsConsumed: 3.5, costTime: 15_000 })]));
    const result = await generateKieImage({ ...request, fetch: fake.fetch });
    assert.deepEqual(result.usage, { credits: 3.5, providerDurationMs: 15_000 });
  });

  it("omits fields KIE did not report instead of filling zeros", async () => {
    const onlyCredits = createFakeFetch(routes(success({ creditsConsumed: 2 })));
    assert.deepEqual((await generateKieImage({ ...request, fetch: onlyCredits.fetch })).usage, { credits: 2 });

    const nothing = createFakeFetch(routes(success({})));
    assert.equal((await generateKieImage({ ...request, fetch: nothing.fetch })).usage, undefined);
  });

  it("keeps the image and warns when usage fields are malformed", async () => {
    const events: ImageProgressEvent[] = [];
    const fake = createFakeFetch(routes(success({ creditsConsumed: "lots", costTime: 900 })));
    const result = await generateKieImage({ ...request, fetch: fake.fetch, onProgress: (event) => events.push(event) });
    assert.equal(result.images.length, 1);
    assert.deepEqual(result.usage, { providerDurationMs: 900 });
    assert.ok(events.some((event) => event.type === "warning" && /creditsConsumed/.test(event.message)));
  });

  it("does not expose token usage to pi-ai (KIE reports credits only)", async () => {
    const fake = createFakeFetch(routes(success({ creditsConsumed: 1, costTime: 10 })));
    const images = createImagesModels();
    images.setProvider(createKieImagesProvider({ apiKey: "kie-key", settings: { poll: { initialDelayMs: 1, maxDelayMs: 1 } } }));
    const model = images.getModel("kie", "nano-banana-2");
    assert.ok(model);
    const result = await images.generateImages(model, { input: [{ type: "text", text: "x" }] }, { fetch: fake.fetch });
    assert.equal(result.stopReason, "stop");
    assert.equal(result.usage, undefined);
  });
});

describe("getKieTask", () => {
  it("re-reads a finished task with its usage", async () => {
    const fake = createFakeFetch(routes(success({ creditsConsumed: 4, costTime: 1_200 })));
    const task = await getKieTask({ apiKey: "kie-key", taskId: "task_1", fetch: fake.fetch });
    assert.deepEqual(task, {
      provider: "kie",
      taskId: "task_1",
      model: "nano-banana-2",
      state: "success",
      resultUrls: [RESULT_URL],
      failCode: undefined,
      failMessage: undefined,
      usage: { credits: 4, providerDurationMs: 1_200 },
    });
    assert.equal(fake.calls.length, 1);
  });

  it("returns failed and pending tasks as states rather than throwing", async () => {
    const failed = createFakeFetch(routes(record({ state: "fail", failCode: "501", failMsg: "upstream", creditsConsumed: 0 })));
    const task = await getKieTask({ apiKey: "kie-key", taskId: "task_1", fetch: failed.fetch });
    assert.equal(task.state, "fail");
    assert.equal(task.failCode, "501");
    assert.deepEqual(task.usage, { credits: 0 });

    const pending = createFakeFetch(routes(record({ state: "queuing" })));
    const queued = await getKieTask({ apiKey: "kie-key", taskId: "task_1", fetch: pending.fetch });
    assert.equal(queued.state, "queuing");
    assert.equal(queued.usage, undefined);
  });

  it("validates input before any request", async () => {
    const fake = createFakeFetch([]);
    await assert.rejects(getKieTask({ apiKey: "kie-key", taskId: " ", fetch: fake.fetch }), (error: unknown) => {
      return isPiAiExtraError(error) && error.code === "invalid_request";
    });
    assert.equal(fake.calls.length, 0);
  });
});
