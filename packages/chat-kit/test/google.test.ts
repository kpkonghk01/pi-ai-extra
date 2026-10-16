import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createFakeFetch, type FakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit } from "../src/index.ts";
import { brokenSseResponse, collect, jsonBody, lastEvent, sseResponse, testDocument, textOf, turn } from "./helpers.ts";

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
      provider: "gemini",
      model: "gemini-3.5-flash",
      message: "[gemini/gemini-3.5-flash] Gemini blocked the prompt (PROHIBITED_CONTENT).",
      reason: "PROHIBITED_CONTENT",
    });
    // Gemini leaves zero-valued counters out, so a blocked prompt reports no answer count, and none is set.
    assert.deepEqual(last.usage, {
      inputTokens: 12,
      totalTokens: 12,
      raw: { usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 } },
    });
  });

  it("keeps the prompt count of a stream that breaks before any answer count, without an outputTokens", async () => {
    const usageMetadata = { promptTokenCount: 5, totalTokenCount: 5 };
    const { chat } = kit([
      {
        method: "POST",
        url: STREAM_URL,
        respond: () =>
          brokenSseResponse([JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hal" }] } }], usageMetadata })]),
      },
    ]);
    const events = await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })));
    assert.equal(textOf(events), "Hal");
    const last = lastEvent(events);
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.deepEqual(last.usage, { inputTokens: 5, totalTokens: 5, raw: { usageMetadata } });
  });

  it("counts a grounded turn's tool-use prompt tokens in inputTokens", async () => {
    const usageMetadata = {
      promptTokenCount: 40,
      toolUsePromptTokenCount: 300,
      candidatesTokenCount: 12,
      thoughtsTokenCount: 8,
      totalTokenCount: 360,
    };
    const { chat } = kit(
      [
        {
          method: "POST",
          url: STREAM_URL,
          respond: () =>
            sseResponse([
              JSON.stringify({
                candidates: [{ content: { role: "model", parts: [{ text: "Found it." }] }, finishReason: "STOP" }],
                usageMetadata,
              }),
            ]),
        },
      ],
      true,
    );
    assert.deepEqual(lastEvent(await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })))), {
      type: "done",
      usage: { inputTokens: 340, outputTokens: 20, reasoningTokens: 8, totalTokens: 360, raw: { usageMetadata } },
    });
  });

  it("omits usage Gemini did not report: no cache or thinking counts without them, no usage without usageMetadata", async () => {
    const answer = (extra: Record<string, unknown>) => () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }], ...extra }),
      ]);
    const usageMetadata = { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 };
    const { chat } = kit([{ method: "POST", url: STREAM_URL, respond: [answer({ usageMetadata }), answer({})] }]);
    assert.deepEqual(lastEvent(await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })))), {
      type: "done",
      usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10, raw: { usageMetadata } },
    });
    assert.deepEqual(lastEvent(await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })))), { type: "done" });
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

  function maxTokensStop(parts: string[]) {
    return () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: parts[0] }] } }] }),
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: parts[1] }] }, finishReason: "MAX_TOKENS" }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 32, totalTokenCount: 36 },
        }),
      ]);
  }

  it("ends a free-form answer cut off at MAX_TOKENS with done and truncated, keeping its text", async () => {
    const { chat } = kit([{ method: "POST", url: STREAM_URL, respond: maxTokensStop(["The first", " half"]) }]);
    const events = await collect(chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash" })));
    assert.equal(textOf(events), "The first half");
    const last = lastEvent(events);
    assert.equal(last.type === "done" && last.truncated, true);
    assert.equal(last.type === "done" && last.usage?.outputTokens, 32);
  });

  it("fails a response-schema answer cut off at MAX_TOKENS, with the raw stop reason", async () => {
    const { chat } = kit([{ method: "POST", url: STREAM_URL, respond: maxTokensStop(['{"tags":', '["a",']) }]);
    const last = lastEvent(
      await collect(
        chat.runTurn(turn({ provider: "gemini", model: "gemini-3.5-flash", responseSchema: { name: "tags", schema: SCHEMA } })),
      ),
    );
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.equal(last.error.reason, "MAX_TOKENS");
    assert.match(last.error.message, /^\[gemini\/gemini-3\.5-flash\] The answer hit the output-token limit/);
    assert.equal(last.usage?.outputTokens, 32);
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
