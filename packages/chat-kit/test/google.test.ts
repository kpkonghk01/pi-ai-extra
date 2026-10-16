import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createFakeFetch, type FakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit } from "../src/index.ts";
import { collect, jsonBody, lastEvent, sseResponse, testDocument, textOf, turn } from "./helpers.ts";

const STREAM_URL = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash:streamGenerateContent\b/;
const SCHEMA = { type: "object", properties: { tags: { type: "array", items: { type: "string" }, maxItems: 3 } } };

/**
 * pi-ai's Gemini adapter rejects a custom fetch, so these tests replace the global fetch the
 * Gemini SDK calls, and restore it afterwards.
 */
describe("runTurn on Gemini", () => {
  let realFetch: typeof globalThis.fetch;
  let savedKey: string | undefined;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "env-key-must-not-be-used";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  function kit(routes: FakeRoute[], grounding = false): { chat: ReturnType<typeof createChatKit>; fake: FakeFetch } {
    const fake = createFakeFetch(routes);
    globalThis.fetch = fake.fetch as typeof globalThis.fetch;
    return { chat: createChatKit({ providers: [{ name: "gemini", provider: "google", apiKey: "gemini-key", grounding }] }), fake };
  }

  it("streams text with grounding, a sanitized response schema and documents by URL or inline", async () => {
    const pdf = testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://cdn.example.com/brief.pdf", size: 1_000 });
    const big = testDocument("big.pdf", "application/pdf", "%PDF-big", { url: "https://cdn.example.com/big.pdf", size: 20_000_000 });
    const { chat, fake } = kit(
      [
        {
          method: "POST",
          url: STREAM_URL,
          respond: () =>
            sseResponse([
              JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: '{"tags":' }] } }] }),
              JSON.stringify({
                candidates: [{ content: { role: "model", parts: [{ text: '["a"]}' }] }, finishReason: "STOP" }],
                usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 6, cachedContentTokenCount: 40, totalTokenCount: 56 },
              }),
            ]),
        },
      ],
      true,
    );
    const events = await collect(
      chat.runTurn(
        turn({ provider: "gemini", model: "gemini-3.5-flash", documents: [pdf, big], responseSchema: { name: "tags", schema: SCHEMA } }),
      ),
    );
    assert.equal(textOf(events), '{"tags":["a"]}');
    assert.deepEqual(lastEvent(events), {
      type: "done",
      usage: {
        inputTokens: 50,
        outputTokens: 6,
        cachedInputTokens: 40,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 56,
        raw: { usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 6, cachedContentTokenCount: 40, totalTokenCount: 56 } },
      },
    });
    assert.equal(pdf.loads, 0);
    assert.equal(big.loads, 1, "over Gemini's 15 MB URL limit: sent inline");
    const call = fake.calls[0];
    assert.equal(call?.headers["x-goog-api-key"], "gemini-key");
    const body = jsonBody(call?.body);
    assert.deepEqual((body.contents as { parts: unknown[] }[])[0]?.parts, [
      { fileData: { fileUri: "https://cdn.example.com/brief.pdf", mimeType: "application/pdf" } },
      { inlineData: { mimeType: "application/pdf", data: Buffer.from("%PDF-big").toString("base64") } },
      { text: "Hello" },
    ]);
    const config = body.generationConfig as Record<string, unknown>;
    assert.equal(config.responseMimeType, "application/json");
    assert.deepEqual(config.responseJsonSchema, { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } });
    assert.deepEqual(body.tools, [{ googleSearch: {} }, { urlContext: {} }]);
  });

  it("reports a prompt-level block (promptFeedback only) as CONTENT_BLOCKED with the billed usage", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: STREAM_URL,
        respond: () =>
          sseResponse([
            JSON.stringify({
              promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
              usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 },
            }),
          ]),
      },
    ]);
    const last = lastEvent(await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" }))));
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.deepEqual(last.error, {
      code: "CONTENT_BLOCKED",
      message: "[gemini/gemini-3.5-flash] Gemini blocked the prompt (PROHIBITED_CONTENT).",
      reason: "PROHIBITED_CONTENT",
    });
    assert.equal(last.usage?.inputTokens, 12);
  });

  it("reports RECITATION as PROVIDER_ERROR, not as a content block", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: STREAM_URL,
        respond: () =>
          sseResponse([
            JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Quote" }] }, finishReason: "RECITATION" }] }),
          ]),
      },
    ]);
    const events = await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })));
    const last = lastEvent(events);
    assert.equal(last.type === "failed" && last.error.code, "PROVIDER_ERROR");
    assert.equal(last.type === "failed" && last.error.reason, "RECITATION");
    assert.equal(last.type === "failed" && last.usage, undefined, "no usage was reported");
  });

  it("reports a candidate SAFETY stop after partial text as CONTENT_BLOCKED", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: STREAM_URL,
        respond: () =>
          sseResponse([
            JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Once" }] } }] }),
            JSON.stringify({
              candidates: [{ finishReason: "SAFETY" }],
              usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
            }),
          ]),
      },
    ]);
    const events = await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })));
    assert.equal(textOf(events), "Once");
    const last = lastEvent(events);
    assert.equal(last.type === "failed" && last.error.code, "CONTENT_BLOCKED");
    assert.equal(last.type === "failed" && last.error.reason, "SAFETY");
  });
});
