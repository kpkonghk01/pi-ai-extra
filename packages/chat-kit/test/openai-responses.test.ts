import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { createChatKit } from "../src/index.ts";
import { collect, jsonBody, lastEvent, sseResponse, textOf, turn } from "./helpers.ts";

const KIE_RESPONSES_URL = "https://api.kie.ai/openai/v1/responses";
const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

function responsesStream(text: string[], terminal: Record<string, unknown>): Response {
  const message = {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: text.join(""), annotations: [] }],
  };
  return sseResponse([
    JSON.stringify({ type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress", usage: null } }),
    JSON.stringify({
      type: "response.output_item.added",
      sequence_number: 1,
      output_index: 0,
      item: { ...message, status: "in_progress", content: [] },
    }),
    ...text.map((delta, index) =>
      JSON.stringify({
        type: "response.output_text.delta",
        sequence_number: 2 + index,
        output_index: 0,
        content_index: 0,
        item_id: "msg_1",
        delta,
      }),
    ),
    JSON.stringify({ type: "response.output_item.done", sequence_number: 10, output_index: 0, item: message }),
    JSON.stringify({ sequence_number: 11, ...terminal }),
  ]);
}

function kit(routes: FakeRoute[]) {
  const fake = createFakeFetch(routes);
  return { chat: createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "kie-key" }], fetch: fake.fetch }), fake };
}

describe("runTurn on OpenAI Responses (KIE Codex)", () => {
  it("sends the response schema as a strict text.format and keeps credits_consumed in raw usage", async () => {
    const usage = {
      input_tokens: 30,
      input_tokens_details: { cached_tokens: 10 },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 34,
    };
    const { chat, fake } = kit([
      {
        method: "POST",
        url: KIE_RESPONSES_URL,
        respond: () =>
          responsesStream(['{"ok":', "true}"], {
            type: "response.completed",
            response: { id: "resp_1", status: "completed", output: [], usage, credits_consumed: 0.48 },
          }),
      },
    ]);
    const events = await collect(
      chat.runTurn(turn({ provider: "kie", model: "gpt-5-6-sol", responseSchema: { name: "verdict", schema: SCHEMA } })),
    );
    assert.equal(textOf(events), '{"ok":true}');
    assert.deepEqual(lastEvent(events), {
      type: "done",
      usage: {
        inputTokens: 30,
        outputTokens: 4,
        cachedInputTokens: 10,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 34,
        raw: { usage, credits_consumed: 0.48 },
      },
    });
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual((body.text as Record<string, unknown>).format, { type: "json_schema", name: "verdict", schema: SCHEMA, strict: true });
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer kie-key");
  });

  it("reports an incomplete content_filter response as CONTENT_BLOCKED", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: KIE_RESPONSES_URL,
        respond: () =>
          responsesStream(["Par"], {
            type: "response.incomplete",
            response: {
              id: "resp_1",
              status: "incomplete",
              incomplete_details: { reason: "content_filter" },
              output: [],
              usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
            },
          }),
      },
    ]);
    const last = lastEvent(await collect(chat.runTurn(turn({ provider: "kie", model: "gpt-5-6-sol" }))));
    assert.equal(last.type === "failed" && last.error.code, "CONTENT_BLOCKED");
    assert.equal(last.type === "failed" && last.error.reason, "content_filter");
    assert.equal(last.type === "failed" && last.usage?.inputTokens, 5);
  });
});
