import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit } from "../src/index.ts";
import { anthropicEvents, collect, jsonBody, lastEvent, sseResponse, testDocument, textOf, turn } from "./helpers.ts";

// The Anthropic SDK posts to the beta Messages endpoint (`/v1/messages?beta=true`).
const OPENROUTER_MESSAGES_URL = /^https:\/\/openrouter\.ai\/api\/v1\/messages\b/;
const KIE_MESSAGES_URL = /^https:\/\/api\.kie\.ai\/anthropic\/v1\/messages\b/;
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

function kit(routes: FakeRoute[]) {
  const fake = createFakeFetch(routes);
  const chat = createChatKit({
    providers: [
      { name: "router", provider: "openrouter", apiKey: "or-key" },
      { name: "kie", provider: "kie", apiKey: "kie-key" },
    ],
    fetch: fake.fetch,
  });
  return { chat, fake };
}

describe("runTurn on Anthropic Messages", () => {
  it("sends documents as document/image blocks with a cache breakpoint on the last document, keeping pi-ai's own", async () => {
    const pdf = testDocument("brief.pdf", "application/pdf", "%PDF-1.7", { url: "https://cdn.example.com/brief.pdf" });
    const notes = testDocument("notes.txt", "text/plain", "Remember the brand voice.");
    const { chat, fake } = kit([
      {
        method: "POST",
        url: OPENROUTER_MESSAGES_URL,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "Sure." }], stopReason: "end_turn" })),
      },
    ]);
    const events = await collect(
      chat.runTurn(
        turn({
          model: "anthropic/claude-sonnet-4.6",
          documents: [notes, pdf],
          history: [
            { role: "user", text: "Q1" },
            { role: "assistant", text: "A1" },
          ],
          message: "Q2",
        }),
      ),
    );
    assert.equal(textOf(events), "Sure.");
    assert.deepEqual(lastEvent(events), {
      type: "done",
      usage: {
        inputTokens: 32,
        outputTokens: 9,
        cachedInputTokens: 5,
        cacheWriteTokens: 7,
        totalTokens: 41,
        raw: { usage: { input_tokens: 20, output_tokens: 9, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 } },
      },
    });
    assert.equal(pdf.loads, 0);
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual(body.system, [{ type: "text", text: "You are a helpful Gem.", cache_control: { type: "ephemeral" } }]);
    const messages = body.messages as { role: string; content: unknown }[];
    assert.deepEqual(messages[0], {
      role: "user",
      content: [
        { type: "text", text: '<document name="notes.txt">\nRemember the brand voice.\n</document>' },
        {
          type: "document",
          source: { type: "url", url: "https://cdn.example.com/brief.pdf" },
          title: "brief.pdf",
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: "Q1" },
      ],
    });
    assert.deepEqual(messages[2], { role: "user", content: [{ type: "text", text: "Q2", cache_control: { type: "ephemeral" } }] });
    const breakpoints = JSON.stringify(body).split('"cache_control"').length - 1;
    assert.equal(breakpoints, 3, "system, last document and last message: within Anthropic's four");
  });

  it("streams a forced tool call's arguments as the answer text for a response schema", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: OPENROUTER_MESSAGES_URL,
        respond: () =>
          sseResponse(
            anthropicEvents({ blocks: [{ type: "tool_use", name: "answer", json: ['{"ti', 'tle":"Hi"}'] }], stopReason: "tool_use" }),
          ),
      },
    ]);
    const events = await collect(
      chat.runTurn(turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA } })),
    );
    assert.deepEqual(
      events.filter((event) => event.type === "text"),
      [
        { type: "text", delta: '{"ti' },
        { type: "text", delta: 'tle":"Hi"}' },
      ],
    );
    assert.equal(lastEvent(events).type, "done");
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual(body.tools, [{ name: "answer", description: "Respond with the answer as this tool's input.", input_schema: SCHEMA }]);
    assert.deepEqual(body.tool_choice, { type: "tool", name: "answer" });
    assert.deepEqual(body.thinking, { type: "disabled" });
  });

  it("fails a response-schema turn whose model answers without the tool call", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: OPENROUTER_MESSAGES_URL,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "Here you go" }], stopReason: "end_turn" })),
      },
    ]);
    const events = await collect(
      chat.runTurn(turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA } })),
    );
    assert.equal(textOf(events), "", "free text is never passed off as the schema answer");
    const last = lastEvent(events);
    assert.equal(last.type === "failed" && last.error.code, "PROVIDER_ERROR");
    assert.equal(last.type === "failed" && last.error.reason, "end_turn");
    assert.match(last.type === "failed" ? last.error.message : "", /without the response-schema tool call/);
  });

  it("reports a refusal as CONTENT_BLOCKED with usage, and keeps KIE's credits_consumed in raw usage", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: KIE_MESSAGES_URL,
        respond: () =>
          sseResponse(
            anthropicEvents({
              blocks: [{ type: "text", text: "I can" }],
              stopReason: "refusal",
              deltaExtra: { credits_consumed: 0.15 },
            }),
          ),
      },
    ]);
    const events = await collect(chat.runTurn(turn({ provider: "kie", model: "claude-sonnet-4-6" })));
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer kie-key");
    assert.equal(textOf(events), "I can");
    const last = lastEvent(events);
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "CONTENT_BLOCKED");
    assert.equal(last.error.reason, "refusal");
    assert.match(last.error.message, /^\[kie\/claude-sonnet-4-6\] Claude stopped with refusal/);
    assert.deepEqual(last.usage?.raw, {
      usage: { input_tokens: 20, output_tokens: 9, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },
      credits_consumed: 0.15,
    });
  });

  it("sends plain-text documents to KIE Claude as text blocks (its file input stays off)", async () => {
    const notes = testDocument("notes.csv", "text/csv", "a,b\n1,2");
    const { chat, fake } = kit([
      {
        method: "POST",
        url: KIE_MESSAGES_URL,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "ok" }], stopReason: "end_turn" })),
      },
    ]);
    const events = await collect(chat.runTurn(turn({ provider: "kie", model: "claude-sonnet-4-6", documents: [notes] })));
    assert.equal(lastEvent(events).type, "done");
    const messages = jsonBody(fake.calls[0]?.body).messages as { content: unknown }[];
    assert.deepEqual(messages[0]?.content, [
      { type: "text", text: '<document name="notes.csv">\na,b\n1,2\n</document>', cache_control: { type: "ephemeral" } },
      { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("rejects a response schema with reasoning, or on a model that always thinks, before sending anything", async () => {
    const { chat, fake } = kit([]);
    const withReasoning = lastEvent(
      await collect(
        chat.runTurn(
          turn({
            model: "anthropic/claude-sonnet-4.6",
            responseSchema: { name: "answer", schema: SCHEMA },
            settings: { reasoning: "high" },
          }),
        ),
      ),
    );
    assert.equal(withReasoning.type === "failed" && withReasoning.error.code, "UNSUPPORTED");
    assert.match(withReasoning.type === "failed" ? withReasoning.error.message : "", /remove settings\.reasoning/);
    const alwaysThinks = lastEvent(
      await collect(chat.runTurn(turn({ provider: "kie", model: "claude-opus-5", responseSchema: { name: "answer", schema: SCHEMA } }))),
    );
    assert.equal(alwaysThinks.type === "failed" && alwaysThinks.error.code, "UNSUPPORTED");
    assert.match(alwaysThinks.type === "failed" ? alwaysThinks.error.message : "", /always thinks/);
    assert.equal(fake.calls.length, 0);
  });
});
