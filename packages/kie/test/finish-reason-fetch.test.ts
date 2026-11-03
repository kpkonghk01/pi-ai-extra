import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kieFinishReasonFetch } from "../src/pi-ai/finish-reason-fetch.ts";

const COMPLETIONS_URL = "https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions";
const SSE = "text/event-stream;charset=UTF-8";

const event = (data: unknown) => `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
const delta = (content: string) => event({ choices: [{ delta: { role: "assistant", content }, index: 0 }], created: 7, id: "chatcmpl-1", object: "chat.completion.chunk" });
const usage = event({ choices: [], created: 7, credits_consumed: 0.01, id: "chatcmpl-3", object: "chat.completion.chunk", usage: { completion_tokens: 2, prompt_tokens: 4, total_tokens: 83 } });

/** The body as the given pieces, one read each, so an event may be split across reads. */
function streamOf(pieces: readonly string[], contentType: string = SSE): () => Promise<Response> {
  return async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": contentType } });
  };
}

const dataLines = (text: string) => text.split("\n").filter((line) => line.startsWith("data:"));
const finishReasons = (text: string) =>
  dataLines(text)
    .filter((line) => !line.includes("[DONE]"))
    .flatMap((line) => (JSON.parse(line.slice(5)).choices ?? []).map((choice: { finish_reason?: string | null }) => choice.finish_reason))
    .filter((reason) => reason !== undefined && reason !== null);

describe("kieFinishReasonFetch", () => {
  it("adds the finish reason KIE leaves out, after its usage chunk and before [DONE], as one chunk of the same completion", async () => {
    const fetch = kieFinishReasonFetch(streamOf([delta("po"), delta("ng"), usage, event("[DONE]")]));
    const text = await (await fetch(COMPLETIONS_URL)).text();
    const lines = dataLines(text);
    assert.equal(lines.length, 5);
    assert.equal(lines.at(-1), "data: [DONE]");
    const added = JSON.parse(lines.at(-2)!.slice(5));
    assert.deepEqual(added, { id: "chatcmpl-1", object: "chat.completion.chunk", created: 7, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    assert.deepEqual(finishReasons(text), ["stop"]);
    assert.equal(text.startsWith(delta("po")), true);
  });

  it("adds it to a stream that ends without [DONE], and when an event is split across reads", async () => {
    const whole = delta("pong") + usage;
    const fetch = kieFinishReasonFetch(streamOf([whole.slice(0, 40), whole.slice(40, 130), whole.slice(130)]));
    const text = await (await fetch(COMPLETIONS_URL)).text();
    assert.deepEqual(finishReasons(text), ["stop"]);
    assert.equal(dataLines(text).length, 3);
    assert.ok(!text.includes("[DONE]"));
  });

  it("leaves a stream that has its finish reason untouched", async () => {
    const finish = event({ choices: [{ delta: {}, finish_reason: "length", index: 0 }], created: 7, id: "chatcmpl-2", object: "chat.completion.chunk" });
    const original = delta("po") + finish + usage + event("[DONE]");
    const text = await (await kieFinishReasonFetch(streamOf([original]))(COMPLETIONS_URL)).text();
    assert.equal(text, original);
  });

  it("adds nothing to a stream that carried no content", async () => {
    const original = usage + event("[DONE]");
    const text = await (await kieFinishReasonFetch(streamOf([original]))(COMPLETIONS_URL)).text();
    assert.equal(text, original);
  });

  it("leaves other routes, JSON bodies and failed responses untouched", async () => {
    const original = delta("pong") + usage + event("[DONE]");
    const responses = await (await kieFinishReasonFetch(streamOf([original]))("https://api.kie.ai/openai/v1/responses")).text();
    assert.equal(responses, original);

    const json = await kieFinishReasonFetch(streamOf(['{"code":401,"msg":"no"}'], "application/json"))(COMPLETIONS_URL);
    assert.equal(await json.text(), '{"code":401,"msg":"no"}');

    const failed = await kieFinishReasonFetch(async () => new Response("bad", { status: 500, headers: { "content-type": SSE } }))(COMPLETIONS_URL);
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), "bad");
  });

  it("keeps the response's status and headers, and takes the request as a URL, a URL object or a Request", async () => {
    const base = async () => new Response(delta("x") + event("[DONE]"), { status: 200, headers: { "content-type": SSE, "x-request-id": "r-1" } });
    for (const input of [COMPLETIONS_URL, new URL(COMPLETIONS_URL), new Request(COMPLETIONS_URL)]) {
      const response = await kieFinishReasonFetch(base)(input);
      assert.equal(response.headers.get("x-request-id"), "r-1");
      assert.deepEqual(finishReasons(await response.text()), ["stop"]);
    }
  });
});
