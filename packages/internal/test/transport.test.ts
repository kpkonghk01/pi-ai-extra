import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  createOperationContext,
  downloadImage,
  isPiAiExtraError,
  pollTask,
  requestJson,
  sendJson,
  type FetchLike,
  type HttpRequest,
  type ImageProgressEvent,
} from "../src/index.ts";
import {
  bytesResponse,
  createFakeFetch,
  hangingResponse,
  jsonResponse,
  PNG_BYTES,
  textResponse,
} from "../src/testing/fake-fetch.ts";

const URL_A = "https://api.example.com/a";

function ctxWith(fetch: FetchLike, signal?: AbortSignal, onProgress?: (event: ImageProgressEvent) => void) {
  return createOperationContext({ provider: "test", model: "model-a", fetch, signal, onProgress });
}

const get = (extra: Partial<HttpRequest> = {}): HttpRequest => ({ url: URL_A, method: "GET", operation: "poll", timeoutMs: 1_000, ...extra });
const isCode = (code: string) => (error: unknown) => isPiAiExtraError(error) && error.code === code;

describe("sendJson", () => {
  it("maps HTTP statuses to error codes with the provider message", async () => {
    const cases: Array<[number, string]> = [
      [401, "auth"],
      [402, "insufficient_credits"],
      [422, "invalid_request"],
      [404, "http"],
    ];
    for (const [status, code] of cases) {
      const fake = createFakeFetch([{ method: "GET", url: URL_A, respond: () => jsonResponse({ error: { message: "nope", code: "E1" } }, status) }]);
      await assert.rejects(sendJson(ctxWith(fake.fetch), get()), (error: unknown) => {
        return isPiAiExtraError(error) && error.code === code && error.status === status && error.providerCode === "E1" && /nope/.test(error.message);
      });
    }
  });

  it("retries idempotent requests on 429/5xx at the same URL, honouring Retry-After", async () => {
    const fake = createFakeFetch([
      {
        method: "GET",
        url: URL_A,
        respond: [
          () => jsonResponse({ message: "slow down" }, 429, { "retry-after": "0" }),
          () => jsonResponse({ message: "busy" }, 503, { "retry-after": "0" }),
          () => jsonResponse({ ok: true }),
        ],
      },
    ]);
    const response = await sendJson(ctxWith(fake.fetch), get({ retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 } }));
    assert.deepEqual(response.body, { ok: true });
    assert.equal(fake.calls.length, 3);
    assert.ok(fake.calls.every((call) => call.url === URL_A));
  });

  it("never retries requests without a retry policy (task submission)", async () => {
    const fake = createFakeFetch([{ method: "POST", url: URL_A, respond: () => jsonResponse({ message: "busy" }, 503) }]);
    await assert.rejects(sendJson(ctxWith(fake.fetch), get({ method: "POST", operation: "submit" })), isCode("http"));
    assert.equal(fake.calls.length, 1);
  });

  it("reports network failures, timeouts, cancellation and non-JSON bodies distinctly", async () => {
    const failing: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(sendJson(ctxWith(failing), get()), isCode("network"));

    const hanging = createFakeFetch([{ method: "GET", url: URL_A, respond: hangingResponse }]);
    await assert.rejects(sendJson(ctxWith(hanging.fetch), get({ timeoutMs: 20 })), isCode("timeout"));

    const controller = new AbortController();
    const pending = sendJson(ctxWith(hanging.fetch, controller.signal), get());
    controller.abort();
    await assert.rejects(pending, isCode("aborted"));

    const html = createFakeFetch([{ method: "GET", url: URL_A, respond: () => textResponse("<html>", 200, "text/html") }]);
    await assert.rejects(sendJson(ctxWith(html.fetch), get()), isCode("invalid_response"));
  });

  it("validates response shapes", async () => {
    const fake = createFakeFetch([{ method: "GET", url: URL_A, respond: () => jsonResponse({ id: 5 }) }]);
    await assert.rejects(requestJson(ctxWith(fake.fetch), get(), z.object({ id: z.string() })), isCode("invalid_response"));
  });
});

describe("pollTask", () => {
  const schedule = { initialDelayMs: 1, maxDelayMs: 2, factor: 2, jitterRatio: 0, timeoutMs: 1_000 };

  it("resolves on the terminal state and reports status changes once", async () => {
    const events: ImageProgressEvent[] = [];
    const states = ["queued", "queued", "running"];
    const value = await pollTask(ctxWith(createFakeFetch([]).fetch, undefined, (event) => events.push(event)), {
      ...schedule,
      taskId: "t1",
      check: async () => {
        const status = states.shift();
        return status ? { done: false, status } : { done: true, value: "ok" };
      },
    });
    assert.equal(value, "ok");
    assert.deepEqual(
      events.flatMap((event) => (event.type === "task_status" ? [event.status] : [])),
      ["queued", "running"],
    );
  });

  it("times out with the task id and stops on cancellation", async () => {
    await assert.rejects(
      pollTask(ctxWith(createFakeFetch([]).fetch), {
        ...schedule,
        timeoutMs: 15,
        taskId: "t2",
        check: async () => ({ done: false, status: "running" }),
      }),
      (error: unknown) => isPiAiExtraError(error) && error.code === "timeout" && error.taskId === "t2",
    );

    const controller = new AbortController();
    const pending = pollTask(ctxWith(createFakeFetch([]).fetch, controller.signal), {
      ...schedule,
      initialDelayMs: 10_000,
      taskId: "t3",
      check: async () => ({ done: false, status: "running" }),
    });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => isPiAiExtraError(error) && error.code === "aborted" && error.taskId === "t3");
  });
});

describe("downloadImage", () => {
  const options = { timeoutMs: 1_000, maxBytes: 1_024, retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 } };

  it("downloads and identifies the image by magic bytes even with a generic content type", async () => {
    const fake = createFakeFetch([{ method: "GET", url: URL_A, respond: () => bytesResponse(PNG_BYTES, "application/octet-stream") }]);
    const image = await downloadImage(ctxWith(fake.fetch), URL_A, options);
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.bytes.byteLength, PNG_BYTES.byteLength);
  });

  it("rejects non-images and oversize results", async () => {
    const html = createFakeFetch([{ method: "GET", url: URL_A, respond: () => textResponse("<html>expired</html>", 200, "text/html") }]);
    await assert.rejects(downloadImage(ctxWith(html.fetch), URL_A, options), isCode("invalid_output"));

    const big = createFakeFetch([{ method: "GET", url: URL_A, respond: () => bytesResponse(new Uint8Array(4_096), "image/png") }]);
    await assert.rejects(downloadImage(ctxWith(big.fetch), URL_A, options), isCode("invalid_output"));
  });

  it("retries the same URL once on a transient failure", async () => {
    const fake = createFakeFetch([
      { method: "GET", url: URL_A, respond: [() => textResponse("bad gateway", 502), () => bytesResponse(PNG_BYTES, "image/png")] },
    ]);
    const image = await downloadImage(ctxWith(fake.fetch), URL_A, options);
    assert.equal(image.mimeType, "image/png");
    assert.equal(fake.calls.length, 2);
  });
});
