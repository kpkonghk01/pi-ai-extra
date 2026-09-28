import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImagesModels } from "@earendil-works/pi-ai";
import { bytesResponse, createFakeFetch, jsonResponse, PNG_BYTES, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { generateToapisImage, getToapisTask, isPiAiExtraError, type ImageProgressEvent } from "../src/index.ts";
import { createToapisImagesProvider } from "../src/pi-ai/index.ts";

const SUBMIT_URL = "https://toapis.com/v1/images/generations";
const STATUS_URL = /^https:\/\/toapis\.com\/v1\/images\/generations\/tsk_1$/;
const RESULT_URL = "https://files.toapis.com/generated/1.png";

const completed = (extra: Record<string, unknown>) => () =>
  jsonResponse({
    id: "tsk_1",
    object: "generation.task",
    model: "gpt-image-2.5-flare",
    status: "completed",
    result: { type: "image", data: [{ url: RESULT_URL }] },
    ...extra,
  });

const SETTLED = {
  billing: { status: "settled", credits: "1500", cost_usd: "0.015" },
  usage: {
    input_tokens: 100,
    output_tokens: 900,
    total_tokens: 1000,
    input_tokens_details: { text_tokens: 20, image_tokens: 80, cached_tokens: 30, cached_tokens_details: { text_tokens: 10, image_tokens: 20 } },
    output_tokens_details: { text_tokens: 0, image_tokens: 900 },
  },
};

function routes(status: FakeRoute["respond"]): FakeRoute[] {
  return [
    { method: "POST", url: SUBMIT_URL, respond: () => jsonResponse({ id: "tsk_1", status: "pending" }) },
    { method: "GET", url: STATUS_URL, respond: status },
    { method: "GET", url: RESULT_URL, respond: () => bytesResponse(PNG_BYTES, "image/png") },
  ];
}

const request = { apiKey: "toapis-key", model: "gpt-image-2.5-flare" as const, prompt: "p", poll: { initialDelayMs: 1, maxDelayMs: 1 } };

describe("ToAPIs usage", () => {
  it("returns settled billing as decimal strings and token details as reported", async () => {
    const fake = createFakeFetch(routes(completed(SETTLED)));
    const result = await generateToapisImage({ ...request, fetch: fake.fetch });
    assert.deepEqual(result.usage, {
      credits: "1500",
      costUsd: "0.015",
      billingStatus: "settled",
      tokens: {
        input: 100,
        output: 900,
        total: 1000,
        inputText: 20,
        inputImage: 80,
        cachedInput: 30,
        cachedInputText: 10,
        cachedInputImage: 20,
        outputText: 0,
        outputImage: 900,
      },
    });
  });

  it("keeps pending billing without amounts and omits unreported fields", async () => {
    const fake = createFakeFetch(routes(completed({ billing: { status: "pending" } })));
    const result = await generateToapisImage({ ...request, fetch: fake.fetch });
    assert.deepEqual(result.usage, { billingStatus: "pending" });

    const none = createFakeFetch(routes(completed({})));
    assert.equal((await generateToapisImage({ ...request, fetch: none.fetch })).usage, undefined);
  });

  it("warns and omits malformed billing instead of failing the finished image", async () => {
    const events: ImageProgressEvent[] = [];
    const fake = createFakeFetch(routes(completed({ billing: { status: "settled", credits: 12 }, usage: { input_tokens: 5 } })));
    const result = await generateToapisImage({ ...request, fetch: fake.fetch, onProgress: (event) => events.push(event) });
    assert.equal(result.images.length, 1);
    assert.deepEqual(result.usage, { tokens: { input: 5 } });
    assert.ok(events.some((event) => event.type === "warning" && /billing/.test(event.message)));
  });

  it("sends clientBusinessId as top-level client_business_id and validates it", async () => {
    const fake = createFakeFetch(routes(completed(SETTLED)));
    await generateToapisImage({ ...request, clientBusinessId: "open-graph-single:req-42", fetch: fake.fetch });
    const body = JSON.parse(String(fake.calls.find((call) => call.url === SUBMIT_URL)?.body)) as Record<string, unknown>;
    assert.equal(body.client_business_id, "open-graph-single:req-42");
    assert.equal((body.metadata as Record<string, unknown> | undefined)?.client_business_id, undefined);

    const none = createFakeFetch(routes(completed(SETTLED)));
    await generateToapisImage({ ...request, fetch: none.fetch });
    assert.equal("client_business_id" in (JSON.parse(String(none.calls[0]?.body)) as object), false);

    const untouched = createFakeFetch([]);
    const unicode = createFakeFetch(routes(completed(SETTLED)));
    await generateToapisImage({ ...request, clientBusinessId: "訂單/2026#1", fetch: unicode.fetch });
    assert.equal((JSON.parse(String(unicode.calls[0]?.body)) as Record<string, unknown>).client_business_id, "訂單/2026#1");

    for (const clientBusinessId of ["", " padded ", "x".repeat(129), "line\nbreak"]) {
      await assert.rejects(generateToapisImage({ ...request, clientBusinessId, fetch: untouched.fetch }), (error: unknown) => {
        return isPiAiExtraError(error) && error.code === "invalid_request" && /clientBusinessId/.test(error.message);
      });
    }
    assert.equal(untouched.calls.length, 0);
  });

  it("maps token usage into pi-ai AssistantImages.usage", async () => {
    const fake = createFakeFetch(routes(completed(SETTLED)));
    const images = createImagesModels();
    images.setProvider(createToapisImagesProvider({ apiKey: "toapis-key", settings: { poll: { initialDelayMs: 1, maxDelayMs: 1 } } }));
    const model = images.getModel("toapis", "gpt-image-2.5-flare");
    assert.ok(model);
    const result = await images.generateImages(model, { input: [{ type: "text", text: "p" }] }, { fetch: fake.fetch, metadata: { clientBusinessId: "proxy:app-1" } });
    assert.equal(result.stopReason, "stop");
    assert.deepEqual(
      { input: result.usage?.input, output: result.usage?.output, cacheRead: result.usage?.cacheRead, totalTokens: result.usage?.totalTokens },
      { input: 70, output: 900, cacheRead: 30, totalTokens: 1000 },
    );
    assert.equal((JSON.parse(String(fake.calls[0]?.body)) as Record<string, unknown>).client_business_id, "proxy:app-1");
  });
});

describe("getToapisTask", () => {
  it("re-reads a task by id with its latest billing", async () => {
    const fake = createFakeFetch(routes([completed({ billing: { status: "pending" } }), completed({ ...SETTLED, client_business_id: "app:1" })]));
    const first = await getToapisTask({ apiKey: "toapis-key", taskId: "tsk_1", fetch: fake.fetch });
    assert.equal(first.usage?.billingStatus, "pending");
    const second = await getToapisTask({ apiKey: "toapis-key", taskId: "tsk_1", fetch: fake.fetch });
    assert.equal(second.status, "completed");
    assert.equal(second.clientBusinessId, "app:1");
    assert.deepEqual(second.resultUrls, [RESULT_URL]);
    assert.equal(second.usage?.billingStatus, "settled");
    assert.equal(second.usage?.costUsd, "0.015");
  });

  it("still returns billing when a completed task's result URLs are gone (lookup is lenient, polling is strict)", async () => {
    const events: ImageProgressEvent[] = [];
    const expired = () => jsonResponse({ id: "tsk_1", status: "completed", result: { type: "image", data: [] }, ...SETTLED });
    const fake = createFakeFetch(routes(expired));
    const task = await getToapisTask({ apiKey: "toapis-key", taskId: "tsk_1", fetch: fake.fetch, onProgress: (event) => events.push(event) });
    assert.equal(task.resultUrls, undefined);
    assert.equal(task.usage?.billingStatus, "settled");
    assert.ok(events.some((event) => event.type === "warning"));

    await assert.rejects(generateToapisImage({ ...request, fetch: createFakeFetch(routes(expired)).fetch }), (error: unknown) => {
      return isPiAiExtraError(error) && error.code === "invalid_response";
    });
  });

  it("returns failed tasks with refunded billing instead of throwing", async () => {
    const fake = createFakeFetch(
      routes(() =>
        jsonResponse({
          id: "tsk_1",
          status: "failed",
          billing: { status: "refunded", credits: "0", cost_usd: "0" },
          error: { code: "generation_failed", message: "upstream 422" },
        }),
      ),
    );
    const task = await getToapisTask({ apiKey: "toapis-key", taskId: "tsk_1", fetch: fake.fetch });
    assert.equal(task.status, "failed");
    assert.equal(task.errorCode, "generation_failed");
    assert.deepEqual(task.usage, { credits: "0", costUsd: "0", billingStatus: "refunded" });
  });
});
