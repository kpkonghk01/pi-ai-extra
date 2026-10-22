import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createFakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { anthropicSchemaUnsupported } from "../src/wire/anthropic-messages.ts";
import { anthropicEvents, jsonBody, outcome,
  outcomeOf,
  runToEnd, sseResponse, testDocument, textOf, turn, wireFetch , testKit } from "./helpers.ts";

// The Anthropic SDK posts to the beta Messages endpoint (`/v1/messages?beta=true`).
const OPENROUTER_MESSAGES_URL = /^https:\/\/openrouter\.ai\/api\/v1\/messages\b/;
const KIE_MESSAGES_URL = /^https:\/\/api\.kie\.ai\/anthropic\/v1\/messages\b/;
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

function kit(routes: FakeRoute[]) {
  const fake = createFakeFetch(routes);
  const chat = testKit(["openrouter", "kie", "toapis"], wireFetch(fake), { keys: { toapis: "toapis-key" } });
  return { chat, fake };
}

describe("streamSimple on Anthropic Messages", () => {
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
    const { events, message } = await runToEnd(chat, turn({
          model: "anthropic/claude-sonnet-4.6",
          documents: [notes, pdf],
          history: [
            { role: "user", text: "Q1" },
            { role: "assistant", text: "A1" },
          ],
          message: "Q2",
        }),);
    assert.equal(textOf(events), "Sure.");
    // No totalTokens: Anthropic reports no total, and the kit never computes one.
    assert.deepEqual(outcomeOf(message), {
      type: "done",
      usage: {
        input: 20,
        output: 9,
        cacheRead: 5,
        cacheWrite: 7,
        // OpenRouter reported no cost: estimated from the catalogue rate (3 in, 15 out, 0.3 cache read,
        // 3.75 cache write per 1M): 20 × 3 + 5 × 0.3 + 7 × 3.75 + 9 × 15 = 222.75 per 1M tokens.
        costUsd: 0.00022275,
        costSource: "estimated",
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
    assert.deepEqual(body.plugins, [{ id: "file-parser", pdf: { engine: "native" } }], "OpenRouter's PDF parser stays native");
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
    const { events, message } = await runToEnd(chat, turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA } }));
    assert.deepEqual(
      events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : [])),
      ['{"ti', 'tle":"Hi"}'],
    );
    assert.equal(outcomeOf(message).type, "done");
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual(body.tools, [{ name: "answer", description: "Respond with the answer as this tool's input.", input_schema: SCHEMA }]);
    assert.deepEqual(body.tool_choice, { type: "tool", name: "answer" });
    assert.deepEqual(body.thinking, { type: "disabled" });
  });

  it("keeps only the schema answer in the final message: free text before the tool call is dropped, and an empty call answers {}", async () => {
    const respond = (json: string[]) => () =>
      sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "Sure! " }, { type: "tool_use", name: "answer", json }], stopReason: "tool_use" }));
    for (const [json, expected] of [
      [['{"ti', 'tle":"Hi"}'], '{"title":"Hi"}'],
      [[""], "{}"],
    ] as const) {
      const { chat } = kit([{ method: "POST", url: OPENROUTER_MESSAGES_URL, respond: respond([...json]) }]);
      const { events, message } = await runToEnd(chat, turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA } }));
      assert.equal(message.stopReason, "stop");
      assert.deepEqual(message.content.map((block) => block.type), ["text"], "one text block: the answer");
      assert.equal(message.content[0]?.type === "text" && message.content[0].text, expected);
      assert.ok(!events.some((event) => event.type === "text_delta" && event.delta === "Sure! "), "free text is never streamed as the answer");
    }
  });

  it("fails a response-schema turn whose model answers without the tool call", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: OPENROUTER_MESSAGES_URL,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "Here you go" }], stopReason: "end_turn" })),
      },
    ]);
    const { events, message } = await runToEnd(chat, turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA } }));
    assert.equal(textOf(events), "", "free text is never passed off as the schema answer");
    const last = outcomeOf(message);
    assert.equal(last.type === "failed" && last.error.code, "PROVIDER_ERROR");
    assert.equal(last.type === "failed" && last.error.reason, "end_turn");
    assert.match(last.type === "failed" ? last.error.message : "", /without the response-schema tool call/);
  });

  it("ends a free-form answer cut off at max_tokens with done and truncated, keeping its text", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: KIE_MESSAGES_URL,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "A long ans" }], stopReason: "max_tokens" })),
      },
    ]);
    const { events, message } = await runToEnd(chat, turn({ provider: "kie", model: "claude-sonnet-4-6" }));
    assert.equal(textOf(events), "A long ans");
    const last = outcomeOf(message);
    assert.equal(last.type === "done" && last.truncated, true);
    assert.equal(last.type === "done" && last.usage?.output, 9);
  });

  it("omits usage the provider did not report: no cache counts without cache fields, no usage without counts", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: KIE_MESSAGES_URL,
        respond: [
          () =>
            sseResponse(
              anthropicEvents({
                blocks: [{ type: "text", text: "ok" }],
                stopReason: "end_turn",
                usage: { input_tokens: 20, output_tokens: 1 },
              }),
            ),
          // pi-ai fails a stream whose message_start has no usage object at all, so the closest
          // response without usage is an empty one, with none on message_delta.
          () =>
            sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "ok" }], stopReason: "end_turn", usage: {}, deltaUsage: null })),
        ],
      },
    ]);
    const withoutCache = await outcome(chat, turn({ provider: "kie", model: "claude-sonnet-4-6" }));
    assert.deepEqual(withoutCache, {
      type: "done",
      usage: { input: 20, output: 9, raw: { usage: { input_tokens: 20, output_tokens: 9 } } },
    });
    const withoutUsage = await outcome(chat, turn({ provider: "kie", model: "claude-sonnet-4-6" }));
    assert.deepEqual(withoutUsage, { type: "done" });
  });

  it("keeps KIE's credits_consumed and the prompt count when no output_tokens is reported", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: KIE_MESSAGES_URL,
        respond: () =>
          sseResponse(
            anthropicEvents({
              blocks: [{ type: "text", text: "ok" }],
              stopReason: "end_turn",
              usage: { input_tokens: 20 },
              deltaUsage: null,
              deltaExtra: { credits_consumed: 0.15 },
            }),
          ),
      },
    ]);
    assert.deepEqual(await outcome(chat, turn({ provider: "kie", model: "claude-sonnet-4-6" })), {
      type: "done",
      usage: { input: 20, costUsd: 0.00075, costSource: "provider", raw: { usage: { input_tokens: 20 }, credits_consumed: 0.15 } },
    });
  });

  it("fails a forced tool call cut off at max_tokens, with the raw stop reason", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: OPENROUTER_MESSAGES_URL,
        respond: () =>
          sseResponse(
            anthropicEvents({ blocks: [{ type: "tool_use", name: "answer", json: ['{"ti', 'tle":"H'] }], stopReason: "max_tokens" }),
          ),
      },
    ]);
    const { message } = await runToEnd(chat, turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA } }));
    const last = outcomeOf(message);
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.equal(last.error.reason, "max_tokens");
    assert.match(last.error.message, /^\[openrouter\/anthropic\/claude-sonnet-4\.6\] The answer hit the output-token limit/);
    assert.equal(last.usage?.output, 9);
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
    const { events, message } = await runToEnd(chat, turn({ provider: "kie", model: "claude-sonnet-4-6" }));
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer kie-key");
    assert.equal(textOf(events), "I can");
    const last = outcomeOf(message);
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
    const { message } = await runToEnd(chat, turn({ provider: "kie", model: "claude-sonnet-4-6", documents: [notes] }));
    assert.equal(outcomeOf(message).type, "done");
    const body = jsonBody(fake.calls[0]?.body);
    const messages = body.messages as { content: unknown }[];
    assert.deepEqual(messages[0]?.content, [
      { type: "text", text: '<document name="notes.csv">\na,b\n1,2\n</document>', cache_control: { type: "ephemeral" } },
      { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
    ]);
    assert.ok(!("plugins" in body), "OpenRouter's plugins never go to KIE");
  });

  it("rejects a response schema with reasoning on ToAPIs, which has no native structured output, before sending anything", async () => {
    const { chat, fake } = kit([]);
    const withReasoning = await outcome(chat, turn({
            provider: "toapis",
            model: "claude-sonnet-4-6",
            responseSchema: { name: "answer", schema: SCHEMA },
            settings: { reasoning: "high" },
          }));
    assert.equal(withReasoning.type === "failed" && withReasoning.error.code, "UNSUPPORTED");
    assert.match(withReasoning.type === "failed" ? withReasoning.error.message : "", /remove the reasoning option/);
    assert.equal(fake.calls.length, 0);
    // ToAPIs offers no always-thinking Claude by default; the rule is the wire's.
    const alwaysThinking = { id: "claude-opus-5-5", api: "anthropic-messages" } as Model<Api>;
    const request = { responseSchema: { name: "answer", schema: SCHEMA }, reasoning: undefined };
    assert.match(anthropicSchemaUnsupported(alwaysThinking, { ...request, nativeStructuredOutput: false }) ?? "", /always thinks/);
    assert.equal(anthropicSchemaUnsupported(alwaysThinking, { ...request, nativeStructuredOutput: true }), undefined);
  });

  it("sends native structured output on KIE for the always-thinking claude-opus-5-5 and for a turn with reasoning", async () => {
    // Verified live on 2026-10-16: KIE claude-opus-5-5 with thinking answered valid JSON under output_config.format.
    const respond = () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: '{"title":"Hi"}' }], stopReason: "end_turn" }));
    const { chat, fake } = kit([{ method: "POST", url: KIE_MESSAGES_URL, respond }]);
    const { events, message } = await runToEnd(chat, turn({ provider: "kie", model: "claude-opus-5-5", responseSchema: { name: "answer", schema: SCHEMA } }));
    assert.equal(textOf(events), '{"title":"Hi"}');
    assert.equal(outcomeOf(message).type, "done");
    const alwaysThinks = jsonBody(fake.calls[0]?.body);
    assert.deepEqual((alwaysThinks.output_config as Record<string, unknown>).format, {
      type: "json_schema",
      schema: { ...SCHEMA, additionalProperties: false },
    });
    assert.equal(alwaysThinks.tools, undefined);
    assert.equal(alwaysThinks.tool_choice, undefined);
    (await runToEnd(chat, turn({ provider: "kie", model: "claude-sonnet-4-6", responseSchema: { name: "answer", schema: SCHEMA }, settings: { reasoning: "high" } }))).events;
    const withReasoning = jsonBody(fake.calls[1]?.body);
    assert.ok(isNativeFormat(withReasoning.output_config));
    assert.equal(withReasoning.tool_choice, undefined);
  });

  it("sends native structured output for OpenRouter's always-thinking anthropic/claude-opus-5 and streams the JSON text", async () => {
    const { chat, fake } = kit([
      {
        method: "POST",
        url: OPENROUTER_MESSAGES_URL,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: '{"title":"Hi"}' }], stopReason: "end_turn" })),
      },
    ]);
    const { events, message } = await runToEnd(chat, turn({ model: "anthropic/claude-opus-5", responseSchema: { name: "answer", schema: SCHEMA } }));
    assert.equal(textOf(events), '{"title":"Hi"}');
    assert.equal(outcomeOf(message).type, "done");
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual((body.output_config as Record<string, unknown>).format, {
      type: "json_schema",
      schema: { ...SCHEMA, additionalProperties: false },
    });
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
  });

  it("sends native structured output on OpenRouter when reasoning is requested on a model that can stop thinking", async () => {
    const respond = () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "{}" }], stopReason: "end_turn" }));
    const { chat, fake } = kit([{ method: "POST", url: OPENROUTER_MESSAGES_URL, respond }]);
    (await runToEnd(chat, turn({ model: "anthropic/claude-sonnet-4.6", responseSchema: { name: "answer", schema: SCHEMA }, settings: { reasoning: "high" } }))).events;
    const thinking = jsonBody(fake.calls[0]?.body);
    assert.ok(isNativeFormat(thinking.output_config));
    assert.equal(thinking.tool_choice, undefined);
  });
});

function isNativeFormat(outputConfig: unknown): boolean {
  return typeof outputConfig === "object" && outputConfig !== null && "format" in outputConfig;
}
