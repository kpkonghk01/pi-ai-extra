import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createOpenRouterProvider } from "@hk01/pi-ai-extra-openrouter/pi-ai";
import { createChatKit } from "../src/index.ts";
import { createFakeFetch, jsonResponse, PNG_BYTES, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import {
  brokenSseResponse,
  collect,
  completionsChunk,
  completionsUsageChunk,
  jsonBody,
  outcome,
  lastEvent,
  outcomeOf,
  run,
  runToEnd,
  sseResponse,
  testDocument,
  textOf,
  turn,
  testKit,
  wireFetch,
} from "./helpers.ts";

const COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };

function kit(routes: FakeRoute[]) {
  const fake = createFakeFetch(routes);
  const chat = testKit(["openrouter"], wireFetch(fake), { keys: { openrouter: "explicit-or-key" } });
  return { chat, fake };
}

/** Sends one text chunk, then waits until the request is aborted. */
function hangingStream(_request: unknown, signal: AbortSignal | undefined): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${completionsChunk({ content: "Start" })}\n\n`));
      signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function okStream() {
  return sseResponse([
    completionsChunk({ role: "assistant", content: "Hel" }),
    completionsChunk({ content: "lo" }, "stop"),
    completionsUsageChunk({
      prompt_tokens: 120,
      completion_tokens: 8,
      total_tokens: 128,
      cost: 0.00042,
      prompt_tokens_details: { cached_tokens: 100 },
      completion_tokens_details: { reasoning_tokens: 3 },
    }),
    "[DONE]",
  ]);
}

describe("streamSimple on OpenAI Completions (OpenRouter)", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "env-key-must-not-be-used";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("streams text and reports usage with the provider's raw record (cost), using only the explicit key", async () => {
    const { chat, fake } = kit([{ method: "POST", url: COMPLETIONS_URL, respond: okStream }]);
    const { events, message } = await runToEnd(chat, turn());
    assert.equal(textOf(events), "Hello");
    assert.deepEqual(outcomeOf(message), {
      type: "done",
      usage: {
        input: 20,
        output: 8,
        cacheRead: 100,
        reasoning: 3,
        totalTokens: 128,
        costUsd: 0.00042,
        costSource: "provider",
        raw: {
          usage: {
            prompt_tokens: 120,
            completion_tokens: 8,
            total_tokens: 128,
            cost: 0.00042,
            prompt_tokens_details: { cached_tokens: 100 },
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        },
      },
    });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer explicit-or-key");
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual(body.plugins, [{ id: "file-parser", pdf: { engine: "native" } }]);
    assert.equal(body.response_format, undefined);
  });

  it("omits usage the provider did not report: no cache counts without cache fields, no usage without a usage chunk", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: [
          () =>
            sseResponse([
              completionsChunk({ content: "Hi" }, "stop"),
              completionsUsageChunk({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
              "[DONE]",
            ]),
          () => sseResponse([completionsChunk({ content: "Hi" }, "stop"), "[DONE]"]),
        ],
      },
    ]);
    assert.deepEqual(await outcome(chat, turn()), {
      type: "done",
      usage: {
        input: 10,
        output: 2,
        totalTokens: 12,
        // No reported cost: estimated from the catalogue rate (0.15 in, 0.6 out per 1M).
        costUsd: 0.0000027,
        costSource: "estimated",
        raw: { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
      },
    });
    assert.deepEqual(await outcome(chat, turn()), { type: "done" });
  });

  it("keeps OpenRouter's reported cost when the answer count is missing", async () => {
    const usage = { prompt_tokens: 10, cost: 0.0001 };
    const { chat } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: () => sseResponse([completionsChunk({ content: "Hi" }, "stop"), completionsUsageChunk(usage), "[DONE]"]),
      },
    ]);
    assert.deepEqual(await outcome(chat, turn()), {
      type: "done",
      usage: { input: 10, costUsd: 0.0001, costSource: "provider", raw: { usage } },
    });
  });

  it("puts system prompt, documents, history and message in that order, documents opening the first user turn", async () => {
    const pdf = testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://cdn.example.com/brief.pdf", size: 9 });
    const png = testDocument("logo.png", "image/png", PNG_BYTES);
    const notes = testDocument("notes.md", "text/markdown; charset=utf-8", "# Notes\nBe brief.");
    const { chat, fake } = kit([{ method: "POST", url: COMPLETIONS_URL, respond: okStream }]);
    const { events, message } = await runToEnd(chat, turn({
          documents: [pdf, png, notes],
          history: [
            { role: "user", text: "First question" },
            { role: "assistant", text: "First answer" },
          ],
          message: "Second question",
          responseSchema: { name: "answer", schema: SCHEMA },
          settings: { temperature: 0.3, maxTokens: 500 },
        }),);
    assert.equal(outcomeOf(message).type, "done");
    assert.equal(pdf.loads, 0, "a PDF sent by URL is never loaded");
    assert.equal(png.loads, 1);
    assert.equal(notes.loads, 1);
    const body = jsonBody(fake.calls[0]?.body);
    const messages = body.messages as { role: string; content: unknown }[];
    assert.deepEqual(
      messages.map((message) => message.role),
      ["system", "user", "assistant", "user"],
    );
    assert.equal(messages[0]?.content, "You are a helpful Gem.");
    assert.deepEqual(messages[1]?.content, [
      { type: "file", file: { filename: "brief.pdf", file_data: "https://cdn.example.com/brief.pdf" } },
      { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}` } },
      { type: "text", text: '<document name="notes.md">\n# Notes\nBe brief.\n</document>' },
      { type: "text", text: "First question" },
    ]);
    assert.equal(messages[3]?.content, "Second question");
    assert.ok(!JSON.stringify(body).includes("chat-kit:documents"), "the marker never reaches the provider");
    assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "answer", schema: SCHEMA, strict: true } });
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.equal(body.temperature, 0.3);
    assert.equal(body.max_completion_tokens, 500);
  });

  it("opens the first user turn with the documents when the history starts with an assistant message", async () => {
    const notes = testDocument("notes.md", "text/markdown", "N");
    const { chat, fake } = kit([{ method: "POST", url: COMPLETIONS_URL, respond: okStream }]);
    (await runToEnd(chat, turn({
          systemPrompt: "",
          documents: [notes],
          history: [
            { role: "assistant", text: "Welcome!" },
            { role: "user", text: "Q1" },
            { role: "assistant", text: "A1" },
          ],
          message: "Q2",
        }))).events;
    const messages = jsonBody(fake.calls[0]?.body).messages as { role: string; content: unknown }[];
    assert.deepEqual(
      messages.map((message) => message.role),
      ["assistant", "user", "assistant", "user"],
    );
    assert.deepEqual(messages[1]?.content, [
      { type: "text", text: '<document name="notes.md">\nN\n</document>' },
      { type: "text", text: "Q1" },
    ]);
    assert.equal(messages[3]?.content, "Q2");
  });

  it("applies a base URL override to both OpenRouter APIs", async () => {
    const fake = createFakeFetch([
      { method: "POST", url: "https://proxy.example.com/openrouter/v1/chat/completions", respond: okStream },
      {
        method: "POST",
        url: /^https:\/\/proxy\.example\.com\/openrouter\/v1\/messages\b/,
        respond: () => sseResponse([]),
      },
    ]);
    const chat = createChatKit({
      providers: [createOpenRouterProvider({ apiKey: "k", baseUrl: "https://proxy.example.com/openrouter/", fetch: wireFetch(fake) })],
      fetch: wireFetch(fake),
    });
    assert.equal((await outcome(chat, turn())).type, "done");
    await runToEnd(chat, turn({ model: "anthropic/claude-sonnet-4.6" }));
    assert.deepEqual(
      fake.calls.map((call) => call.url.split("?")[0]),
      ["https://proxy.example.com/openrouter/v1/chat/completions", "https://proxy.example.com/openrouter/v1/messages"],
    );
  });

  it("reports content_filter as CONTENT_BLOCKED after partial text, with the reported usage", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: () =>
          sseResponse([
            completionsChunk({ content: "Partial" }),
            completionsChunk({}, "content_filter"),
            completionsUsageChunk({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }),
            "[DONE]",
          ]),
      },
    ]);
    const { events, message } = await runToEnd(chat, turn());
    assert.equal(textOf(events), "Partial");
    const last = outcomeOf(message);
    assert.equal(last.type, "failed");
    assert.equal(last.type === "failed" && last.error.code, "CONTENT_BLOCKED");
    assert.equal(last.type === "failed" && last.error.reason, "content_filter");
    assert.match(last.type === "failed" ? last.error.message : "", /^\[openrouter\/openai\/gpt-4o-mini\] /);
    assert.equal(last.type === "failed" && last.usage?.input, 10);
  });

  it("retries a transient failure before generation starts, with the same provider and model", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: [() => jsonResponse({ error: { message: "overloaded" } }, 503, { "retry-after-ms": "1" }), okStream],
      },
    ]);
    const { events, message } = await runToEnd(chat, turn());
    assert.equal(outcomeOf(message).type, "done");
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(
      fake.calls.map((call) => jsonBody(call.body).model),
      ["openai/gpt-4o-mini", "openai/gpt-4o-mini"],
    );
  });

  it("gives up after two retries and reports the last status", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: () => jsonResponse({ error: { message: "overloaded" } }, 503, { "retry-after-ms": "1" }),
      },
    ]);
    const last = await outcome(chat, turn());
    assert.equal(fake.calls.length, 3);
    assert.equal(last.type === "failed" && last.error.code, "PROVIDER_ERROR");
    assert.equal(last.type === "failed" && last.error.status, 503);
  });

  it("never retries after the first token", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: [() => brokenSseResponse([completionsChunk({ content: "Half an ans" })]), okStream],
      },
    ]);
    const { events, message } = await runToEnd(chat, turn());
    assert.equal(fake.calls.length, 1);
    assert.equal(textOf(events), "Half an ans");
    const last = outcomeOf(message);
    assert.equal(last.type === "failed" && last.error.code, "PROVIDER_ERROR");
  });

  it("reports a rejected request as PROVIDER_ERROR with its HTTP status, without retrying it", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: COMPLETIONS_URL,
        respond: () => jsonResponse({ error: { message: "No endpoints support response_format" } }, 404),
      },
    ]);
    const { events, message } = await runToEnd(chat, turn({ responseSchema: { name: "answer", schema: SCHEMA } }));
    assert.equal(fake.calls.length, 1);
    const last = outcomeOf(message);
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.equal(last.error.status, 404);
    assert.match(last.error.message, /No endpoints support response_format/);
    assert.equal(last.usage, undefined);
  });

  function lengthStop(content: string) {
    return () =>
      sseResponse([
        completionsChunk({ content: content.slice(0, 4) }),
        completionsChunk({ content: content.slice(4) }, "length"),
        completionsUsageChunk({ prompt_tokens: 3, completion_tokens: 5 }),
        "[DONE]",
      ]);
  }

  it("ends a free-form answer cut off at the output-token limit with done and truncated, keeping its text", async () => {
    const { chat } = kit([{ method: "POST", url: COMPLETIONS_URL, respond: lengthStop("Long answ") }]);
    const { events, message } = await runToEnd(chat, turn());
    assert.equal(textOf(events), "Long answ");
    const last = outcomeOf(message);
    assert.equal(last.type, "done");
    if (last.type !== "done") return;
    assert.equal(last.truncated, true);
    assert.equal(last.usage?.output, 5);
  });

  it("fails a response-schema answer cut off at the output-token limit, with the raw stop reason", async () => {
    const { chat } = kit([{ method: "POST", url: COMPLETIONS_URL, respond: lengthStop('{"title":"Lo') }]);
    const last = await outcome(chat, turn({ responseSchema: { name: "answer", schema: SCHEMA } }));
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.equal(last.error.reason, "length");
    assert.match(last.error.message, /^\[openrouter\/openai\/gpt-4o-mini\] The answer hit the output-token limit/);
    assert.equal(last.usage?.output, 5);
  });

  it("ends as aborted, without an error, when the caller aborts mid-stream", async () => {
    const { chat } = kit([{ method: "POST", url: COMPLETIONS_URL, respond: hangingStream }]);
    const controller = new AbortController();
    const events = [];
    const stream = run(chat, turn(), controller.signal);
    for await (const event of stream) {
      events.push(event);
      if (event.type === "text_delta") controller.abort();
    }
    assert.equal(textOf(events), "Start");
    const message = await stream.result();
    assert.equal(message.stopReason, "aborted");
    assert.equal(message.chatKit.error, undefined);
    assert.equal(lastEvent(events).type, "error");
  });
});
