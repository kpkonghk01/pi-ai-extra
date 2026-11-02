import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Type, type Context, type Tool } from "@earendil-works/pi-ai";
import { zeroUsage } from "@hk01/pi-ai-extra-internal/pi-ai";
import { createFakeFetch, jsonResponse, type FakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import type { ChatKit } from "../src/index.ts";
import { brokenSseResponse, jsonBody, outcome,
  outcomeOf,
  runToEnd, sseResponse, testDocument, textOf, turn, wireFetch , testKit, type TestTurn } from "./helpers.ts";

const STREAM_URL = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash:streamGenerateContent\b/;
const SCHEMA = { type: "object", properties: { tags: { type: "array", items: { type: "string" }, maxItems: 3 } } };
/** A PDF the kit sends by URL (`fileData`): its URL is set and its size is within Gemini's limit. */
const pdfByUrl = () => testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://cdn.example.com/brief.pdf", size: 1_000 });

/**
 * pi-ai's Gemini adapter rejects a custom fetch, so these tests replace the global fetch the
 * Gemini SDK calls, and restore it afterwards.
 */
describe("streamSimple on Gemini", () => {
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

  function kit(routes: FakeRoute[], grounding = false): { chat: ChatKit; fake: FakeFetch } {
    const fake = createFakeFetch(routes);
    globalThis.fetch = fake.fetch as typeof globalThis.fetch;
    // The kit's own fetch serves only the model list here; the turn goes through the global fetch.
    return { chat: testKit(["google"], wireFetch(fake), { grounding, keys: { google: "gemini-key" } }), fake };
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
    const { events, message } = await runToEnd(chat, turn({ provider: "google", model: "gemini-3.5-flash", documents: [pdf, big], responseSchema: { name: "tags", schema: SCHEMA } }),);
    assert.equal(textOf(events), '{"tags":["a"]}');
    assert.deepEqual(outcomeOf(message), {
      type: "done",
      usage: {
        input: 10,
        output: 6,
        cacheRead: 40,
        totalTokens: 56,
        // gemini-3.5-flash has no entry in the Gemini rate table: pi-ai's list price (1.5 in, 9 out,
        // 0.15 cached per 1M): 10 × 1.5 + 40 × 0.15 + 6 × 9 = 75 per 1M tokens.
        costUsd: 0.000075,
        costSource: "estimated",
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

  it("sends a response schema over a conversation that holds a tool call and its result, with no declared tools: the provider decides", async () => {
    const { chat, fake } = kit([
      { method: "POST", url: STREAM_URL, respond: () => sseResponse([JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "{}" }] }, finishReason: "STOP" }] })]) },
    ]);
    const history: Context["messages"] = [
      { role: "user", content: "Look it up", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "lookup", arguments: { q: "cats" } }],
        api: "google-generative-ai",
        provider: "google",
        model: "gemini-3.5-flash",
        usage: zeroUsage(),
        stopReason: "toolUse",
        timestamp: 2,
      },
      { role: "toolResult", toolCallId: "t1", toolName: "lookup", content: [{ type: "text", text: "found" }], isError: false, timestamp: 3 },
    ];
    const message = await chat.completeSimple({ provider: "google", id: "gemini-3.5-flash" }, { messages: history }, { responseSchema: { name: "tags", schema: SCHEMA } });
    assert.equal(message.stopReason, "stop");
    const post = fake.calls.find((call) => call.method === "POST");
    const body = JSON.stringify(jsonBody(post?.body));
    assert.match(body, /responseJsonSchema/, "the schema is in the request");
    assert.match(body, /"functionCall"/, "so is the tool call of the history");
    assert.match(body, /"functionResponse"/, "and its result");
    assert.equal(jsonBody(post?.body).tools, undefined, "no tools are declared");
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
    const last = await outcome(chat, turn({ provider: "google", model: "gemini-3.5-flash" }));
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.deepEqual(last.error, {
      code: "CONTENT_BLOCKED",
      message: "[google/gemini-3.5-flash] Gemini blocked the prompt (PROHIBITED_CONTENT).",
      reason: "PROHIBITED_CONTENT",
    });
    // Gemini leaves zero-valued counters out, so a blocked prompt reports no answer count, and none is set.
    assert.deepEqual(last.usage, {
      input: 12,
      totalTokens: 12,
      costUsd: 0.000018,
      costSource: "estimated",
      raw: { usageMetadata: { promptTokenCount: 12, totalTokenCount: 12 } },
    });
  });

  it("keeps the prompt count of a stream that breaks before any answer count, without an output", async () => {
    const usageMetadata = { promptTokenCount: 5, totalTokenCount: 5 };
    const { chat } = kit([
      {
        method: "POST",
        url: STREAM_URL,
        respond: () =>
          brokenSseResponse([JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hal" }] } }], usageMetadata })]),
      },
    ]);
    const { events, message } = await runToEnd(chat, turn({ provider: "google", model: "gemini-3.5-flash" }));
    assert.equal(textOf(events), "Hal");
    const last = outcomeOf(message);
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.deepEqual(last.usage, { input: 5, totalTokens: 5, costUsd: 0.0000075, costSource: "estimated", raw: { usageMetadata } });
  });

  it("counts a grounded turn's tool-use prompt tokens in input", async () => {
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
    assert.deepEqual(await outcome(chat, turn({ provider: "google", model: "gemini-3.5-flash" })), {
      type: "done",
      usage: {
        input: 340,
        output: 20,
        reasoning: 8,
        totalTokens: 360,
        costUsd: 0.00069,
        costSource: "estimated",
        raw: { usageMetadata },
      },
    });
  });

  /** A grounded turn with a PDF by URL, whose one chunk reports `usageMetadata`. */
  async function groundedUsage(usageMetadata: Record<string, unknown>) {
    const { chat } = kit(
      [
        {
          method: "POST",
          url: STREAM_URL,
          respond: () =>
            sseResponse([JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Found it." }] }, finishReason: "STOP" }], usageMetadata })]),
        },
      ],
      true,
    );
    return outcome(chat, turn({ provider: "google", model: "gemini-3.5-flash", documents: [pdfByUrl()] }));
  }

  it("derives a grounded, thinking turn's missing prompt count from the total, and counts its cached tokens in it", async () => {
    const usageMetadata = { cachedContentTokenCount: 30, candidatesTokenCount: 12, thoughtsTokenCount: 8, toolUsePromptTokenCount: 300, totalTokenCount: 360 };
    assert.deepEqual(await groundedUsage(usageMetadata), {
      type: "done",
      usage: {
        // The prompt is 360 - 12 - 8 - 300 = 40 tokens, 30 of them cached, plus the 300 tool-use prompt tokens.
        input: 310,
        output: 20,
        cacheRead: 30,
        reasoning: 8,
        totalTokens: 360,
        // 310 × 1.5 + 30 × 0.15 + 20 × 9 per 1M tokens.
        costUsd: 0.0006495,
        costSource: "estimated",
        raw: { usageMetadata },
      },
    });
  });

  it("derives no prompt count from a total smaller than the other counts", async () => {
    const usageMetadata = { candidatesTokenCount: 50, toolUsePromptTokenCount: 80, totalTokenCount: 100 };
    assert.deepEqual(await groundedUsage(usageMetadata), {
      type: "done",
      // 100 - 50 - 80 is below 0, so the prompt stays unreported, and input is the tool-use prompt alone: 80 × 1.5 + 50 × 9 per 1M tokens.
      usage: { input: 80, output: 50, totalTokens: 100, costUsd: 0.00057, costSource: "estimated", raw: { usageMetadata } },
    });
  });

  it("omits usage Gemini did not report: no cache or thinking counts without them, no usage without usageMetadata", async () => {
    const answer = (extra: Record<string, unknown>) => () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }], ...extra }),
      ]);
    const usageMetadata = { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 };
    const { chat } = kit([{ method: "POST", url: STREAM_URL, respond: [answer({ usageMetadata }), answer({})] }]);
    assert.deepEqual(await outcome(chat, turn({ provider: "google", model: "gemini-3.5-flash" })), {
      type: "done",
      usage: { input: 8, output: 2, totalTokens: 10, costUsd: 0.00003, costSource: "estimated", raw: { usageMetadata } },
    });
    assert.deepEqual(await outcome(chat, turn({ provider: "google", model: "gemini-3.5-flash" })), { type: "done" });
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
    const { message } = await runToEnd(chat, turn({ provider: "google", model: "gemini-3.5-flash" }));
    const last = outcomeOf(message);
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
    const { events, message } = await runToEnd(chat, turn({ provider: "google", model: "gemini-3.5-flash" }));
    assert.equal(textOf(events), "The first half");
    const last = outcomeOf(message);
    assert.equal(last.type === "done" && last.truncated, true);
    assert.equal(last.type === "done" && last.usage?.output, 32);
  });

  it("fails a response-schema answer cut off at MAX_TOKENS, with the raw stop reason", async () => {
    const { chat } = kit([{ method: "POST", url: STREAM_URL, respond: maxTokensStop(['{"tags":', '["a",']) }]);
    const last = await outcome(chat, turn({ provider: "google", model: "gemini-3.5-flash", responseSchema: { name: "tags", schema: SCHEMA } }));
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.equal(last.error.reason, "MAX_TOKENS");
    assert.match(last.error.message, /^\[google\/gemini-3\.5-flash\] The answer hit the output-token limit/);
    assert.equal(last.usage?.output, 32);
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
    const { events, message } = await runToEnd(chat, turn({ provider: "google", model: "gemini-3.5-flash" }));
    assert.equal(textOf(events), "Once");
    const last = outcomeOf(message);
    assert.equal(last.type === "failed" && last.error.code, "CONTENT_BLOCKED");
    assert.equal(last.type === "failed" && last.error.reason, "SAFETY");
  });
});

const VERTEX_STREAM_URL = /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\/gemini-3\.5-flash:streamGenerateContent\b/;
const LOOKUP: Tool = { name: "lookup", description: "Looks something up.", parameters: Type.Object({ q: Type.String() }) };

/**
 * Agent Platform (`google-vertex`, pi-ai's Vertex adapter) speaks the same `@google/genai` request
 * and stream as AI Studio (`google`), so the kit fills the same gaps: the same turn, against the
 * same answer, must come out the same on both.
 */
describe("streamSimple on Agent Platform (google-vertex)", () => {
  let realFetch: typeof globalThis.fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Runs the turn on `provider`, against `answer` from either endpoint; returns what the kit made of it and what it sent. */
  async function runOn(provider: "google" | "google-vertex", input: Partial<TestTurn>, answer: () => Response) {
    const fake = createFakeFetch([
      { method: "POST", url: STREAM_URL, respond: answer },
      { method: "POST", url: VERTEX_STREAM_URL, respond: answer },
    ]);
    globalThis.fetch = fake.fetch as typeof globalThis.fetch;
    const chat = testKit([provider], wireFetch(fake), { grounding: true });
    const { events, message } = await runToEnd(chat, turn({ provider, model: "gemini-3.5-flash", ...input }));
    const post = fake.calls.find((call) => call.method === "POST");
    const body = post === undefined ? {} : jsonBody(post.body);
    return {
      url: fake.calls[0]?.url,
      events: events.map((event) => event.type),
      content: message.content,
      outcome: outcomeOf(message),
      sent: { contents: body.contents, tools: body.tools, safetySettings: body.safetySettings, generationConfig: body.generationConfig },
    };
  }

  it("places documents, maps thinking, text and tool-call blocks, and reads usage as on Gemini", async () => {
    const usageMetadata = { promptTokenCount: 50, cachedContentTokenCount: 40, candidatesTokenCount: 6, thoughtsTokenCount: 4, totalTokenCount: 60 };
    const answer = () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Checking.", thought: true, thoughtSignature: "c2lnbmF0dXJl" }] } }] }),
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Let me look." }] } }] }),
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call-1", name: "lookup", args: { q: "cats" } } }] }, finishReason: "STOP" }],
          usageMetadata,
        }),
      ]);
    const documents = () => [
      testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://cdn.example.com/brief.pdf", size: 1_000 }),
      testDocument("big.pdf", "application/pdf", "%PDF-big", { url: "https://cdn.example.com/big.pdf", size: 20_000_000 }),
      testDocument("notes.md", "text/markdown", "# Notes"),
    ];
    const input = { tools: [LOOKUP], settings: { reasoning: "low" as const } };
    const gemini = await runOn("google", { ...input, documents: documents() }, answer);
    const vertex = await runOn("google-vertex", { ...input, documents: documents() }, answer);

    assert.match(vertex.url ?? "", VERTEX_STREAM_URL);
    assert.deepEqual(vertex.events, gemini.events);
    assert.deepEqual(vertex.content, gemini.content);
    assert.deepEqual(vertex.content.map((block) => block.type), ["thinking", "text", "toolCall"]);
    assert.deepEqual(vertex.outcome, gemini.outcome);
    assert.deepEqual(vertex.outcome, {
      type: "done",
      // pi-ai's Vertex list price for gemini-3.5-flash, as on Gemini: 10 × 1.5 + 40 × 0.15 + 10 × 9 per 1M tokens.
      usage: { input: 10, output: 10, cacheRead: 40, reasoning: 4, totalTokens: 60, costUsd: 0.000111, costSource: "estimated", raw: { usageMetadata } },
    });
    assert.deepEqual(vertex.sent.contents, gemini.sent.contents);
    assert.deepEqual((vertex.sent.contents as { parts: Record<string, unknown>[] }[])[0]?.parts.slice(0, 3), [
      { fileData: { fileUri: "https://cdn.example.com/brief.pdf", mimeType: "application/pdf" } },
      { inlineData: { mimeType: "application/pdf", data: Buffer.from("%PDF-big").toString("base64") } },
      { text: '<document name="notes.md">\n# Notes\n</document>' },
    ]);
    assert.deepEqual(vertex.sent.tools, gemini.sent.tools);
    assert.deepEqual(vertex.sent.safetySettings, gemini.sent.safetySettings);
  });

  it("reads usage from the last chunk when every chunk reports the counts, on both Google APIs", async () => {
    // The fields Agent Platform reported for a PDF by URL on 2026-11-02, as running counts in every chunk.
    const usageMetadata = {
      promptTokenCount: 567,
      candidatesTokenCount: 3,
      totalTokenCount: 570,
      trafficType: "ON_DEMAND",
      promptTokensDetails: [{ modality: "IMAGE", tokenCount: 532 }, { modality: "TEXT", tokenCount: 35 }],
      candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 3 }],
    };
    const runningCounts = (candidates: number) => ({
      ...usageMetadata,
      candidatesTokenCount: candidates,
      totalTokenCount: 567 + candidates,
      candidatesTokensDetails: [{ modality: "TEXT", tokenCount: candidates }],
    });
    const answer = () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Dummy" }] } }], usageMetadata: runningCounts(1) }),
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: " PDF file" }] } }], usageMetadata: runningCounts(2) }),
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP" }], usageMetadata }),
      ]);
    for (const provider of ["google", "google-vertex"] as const) {
      assert.deepEqual(
        (await runOn(provider, { documents: [pdfByUrl()] }, answer)).outcome,
        // 567 × 1.5 + 3 × 9 per 1M tokens.
        { type: "done", usage: { input: 567, output: 3, totalTokens: 570, costUsd: 0.0008775, costSource: "estimated", raw: { usageMetadata } } },
        provider,
      );
    }
  });

  it("keeps the prompt count an earlier chunk reported when the last chunk leaves it out, on both Google APIs", async () => {
    const answer = () =>
      sseResponse([
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: "Dummy" }] } }],
          usageMetadata: { promptTokenCount: 24_110, candidatesTokenCount: 1, totalTokenCount: 24_111 },
        }),
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: " PDF file" }] }, finishReason: "STOP" }],
          usageMetadata: { candidatesTokenCount: 3_070, totalTokenCount: 27_180, serviceTier: "standard" },
        }),
      ]);
    for (const provider of ["google", "google-vertex"] as const) {
      assert.deepEqual(
        (await runOn(provider, { documents: [pdfByUrl()] }, answer)).outcome,
        {
          type: "done",
          usage: {
            input: 24_110,
            output: 3_070,
            totalTokens: 27_180,
            // pi-ai's list price for gemini-3.5-flash on both APIs: 24,110 × 1.5 + 3,070 × 9 per 1M tokens.
            costUsd: 0.063795,
            costSource: "estimated",
            raw: { usageMetadata: { promptTokenCount: 24_110, candidatesTokenCount: 3_070, totalTokenCount: 27_180, serviceTier: "standard" } },
          },
        },
        provider,
      );
    }
  });

  it("derives the prompt count from the total when no chunk reported it, as Gemini does for a document by URL, on both Google APIs", async () => {
    const usageMetadata = { candidatesTokenCount: 3_070, totalTokenCount: 27_180, serviceTier: "standard" };
    const answer = () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Dummy" }] } }] }),
        JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: " PDF file" }] }, finishReason: "STOP" }], usageMetadata }),
      ]);
    for (const provider of ["google", "google-vertex"] as const) {
      assert.deepEqual(
        (await runOn(provider, { documents: [pdfByUrl()] }, answer)).outcome,
        // 27,180 - 3,070 prompt tokens, priced as in the turn above; raw keeps what Gemini sent.
        { type: "done", usage: { input: 24_110, output: 3_070, totalTokens: 27_180, costUsd: 0.063795, costSource: "estimated", raw: { usageMetadata } } },
        provider,
      );
    }
  });

  it("fails a turn whose document URL Google could not fetch with DOCUMENT_FETCH_FAILED, on both Google APIs, and leaves any other 400, or one for a turn with no document by URL, a PROVIDER_ERROR", async () => {
    const googleError = (message: string) => () => jsonResponse({ error: { code: 400, message, status: "INVALID_ARGUMENT" } }, 400);
    const unfetchable = googleError("Cannot fetch content from the provided URL. Please ensure the URL is valid and accessible.");
    const document = () => testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://bucket.example.com/brief.pdf?X-Amz-Signature=s", size: 1_000 });
    for (const provider of ["google", "google-vertex"] as const) {
      const failed = (await runOn(provider, { documents: [document()] }, unfetchable)).outcome;
      assert.equal(failed.type, "failed", provider);
      if (failed.type !== "failed") continue;
      assert.deepEqual([failed.error.code, failed.error.status], ["DOCUMENT_FETCH_FAILED", 400], provider);
      assert.match(failed.error.message, new RegExp(`^\\[${provider}/gemini-3\\.5-flash\\] The provider could not fetch a document from its URL: .*Cannot fetch content from the provided URL`));

      const other = (await runOn(provider, { documents: [document()] }, googleError("Request contains an invalid argument."))).outcome;
      assert.equal(other.type === "failed" && other.error.code, "PROVIDER_ERROR", provider);
      assert.equal(other.type === "failed" && other.error.status, 400, provider);

      // The same answer to a turn that sent no document by URL (the PDF goes inline: its size is unknown) is not about a document.
      const inline = testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://bucket.example.com/brief.pdf" });
      const unrelated = (await runOn(provider, { documents: [inline] }, unfetchable)).outcome;
      assert.equal(unrelated.type === "failed" && unrelated.error.code, "PROVIDER_ERROR", provider);
    }
  });

  it("sends a response schema sanitized as on Gemini", async () => {
    const answer = () => sseResponse([JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: '{"tags":["a"]}' }] }, finishReason: "STOP" }] })]);
    const input = { responseSchema: { name: "tags", schema: SCHEMA } };
    const gemini = await runOn("google", input, answer);
    const vertex = await runOn("google-vertex", input, answer);
    assert.deepEqual(vertex.outcome, gemini.outcome);
    assert.deepEqual(vertex.sent.generationConfig, gemini.sent.generationConfig);
    const config = vertex.sent.generationConfig as Record<string, unknown>;
    assert.equal(config.responseMimeType, "application/json");
    assert.deepEqual(config.responseJsonSchema, { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } });
  });
});
