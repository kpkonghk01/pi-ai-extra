import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kieEnvelopeFetch } from "../src/pi-ai/envelope-fetch.ts";

const respond = (body: string, contentType: string, status: number = 200) => async () =>
  new Response(body, { status, headers: { "content-type": contentType } });

describe("kieEnvelopeFetch", () => {
  it("turns KIE's HTTP-200 error envelope into an HTTP error with KIE's code and message", async () => {
    const msg = "Unauthorized – Authentication failed.";
    const fetch = kieEnvelopeFetch(respond(JSON.stringify({ code: 401, msg }), "application/json;charset=utf-8"));
    const response = await fetch("https://api.kie.ai/api/v1/responses");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { type: "error", error: { type: "kie_error", code: 401, message: `KIE code 401: ${msg}` } });
  });

  it("maps non-HTTP KIE codes to 502 and leaves streams and successful JSON untouched", async () => {
    assert.equal((await kieEnvelopeFetch(respond(JSON.stringify({ code: 455, msg: "maintenance" }), "application/json"))("u")).status, 455);
    assert.equal((await kieEnvelopeFetch(respond(JSON.stringify({ code: 1001, msg: "odd" }), "application/json"))("u")).status, 502);

    const sse = await kieEnvelopeFetch(respond("event: response.created\ndata: {}\n\n", "text/event-stream"))("u");
    assert.equal(sse.status, 200);
    assert.match(await sse.text(), /response.created/);

    const ok = await kieEnvelopeFetch(respond(JSON.stringify({ id: "resp_1", output: [] }), "application/json"))("u");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: "resp_1", output: [] });
  });
});
