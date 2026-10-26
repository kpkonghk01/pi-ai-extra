import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeFetch, type FakeRoute } from "@hk01/pi-ai-extra-internal/testing";
import { jsonBody, outcome, outcomeOf, runToEnd, sseResponse, testKit, textOf, turn, withEnv, wireFetch } from "./helpers.ts";

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
  return { chat: testKit(["kie"], wireFetch(fake)), fake };
}

describe("streamSimple on OpenAI Responses (KIE Codex)", () => {
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
    const { events, message } = await runToEnd(chat, turn({ provider: "kie", model: "gpt-5-6-sol", responseSchema: { name: "verdict", schema: SCHEMA } }));
    assert.equal(textOf(events), '{"ok":true}');
    assert.deepEqual(outcomeOf(message), {
      type: "done",
      usage: {
        input: 20,
        output: 4,
        cacheRead: 10,
        reasoning: 0,
        totalTokens: 34,
        costUsd: 0.0024,
        costSource: "provider",
        raw: { usage, credits_consumed: 0.48 },
      },
    });
    const body = jsonBody(fake.calls[0]?.body);
    assert.deepEqual((body.text as Record<string, unknown>).format, { type: "json_schema", name: "verdict", schema: SCHEMA, strict: true });
    assert.equal(fake.calls[0]?.headers.authorization, "Bearer kie-key");
  });

  it("omits usage the provider did not report: no cache or reasoning counts without details, no usage without a usage object", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: KIE_RESPONSES_URL,
        respond: [
          () =>
            responsesStream(["ok"], {
              type: "response.completed",
              response: { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 30, output_tokens: 4, total_tokens: 34 } },
            }),
          () => responsesStream(["ok"], { type: "response.completed", response: { id: "resp_1", status: "completed", output: [] } }),
        ],
      },
    ]);
    assert.deepEqual(await outcome(chat, turn({ provider: "kie", model: "gpt-5-6-sol" })), {
      type: "done",
      usage: {
        input: 30,
        output: 4,
        totalTokens: 34,
        raw: { usage: { input_tokens: 30, output_tokens: 4, total_tokens: 34 } },
      },
    });
    assert.deepEqual(await outcome(chat, turn({ provider: "kie", model: "gpt-5-6-sol" })), { type: "done" });
  });

  it("keeps KIE's credits_consumed and the prompt count when no output_tokens is reported", async () => {
    const { chat } = kit([
      {
        method: "POST",
        url: KIE_RESPONSES_URL,
        respond: () =>
          responsesStream(["ok"], {
            type: "response.completed",
            response: { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 30 }, credits_consumed: 0.48 },
          }),
      },
    ]);
    assert.deepEqual(await outcome(chat, turn({ provider: "kie", model: "gpt-5-6-sol" })), {
      type: "done",
      usage: { input: 30, costUsd: 0.0024, costSource: "provider", raw: { usage: { input_tokens: 30 }, credits_consumed: 0.48 } },
    });
  });

  it("prices a KIE Codex turn from credits_consumed wherever the terminal event carries it, never from its zero prompt count", async () => {
    // A live gpt-6-sol turn on 2026-10-16 reported input_tokens 0 and credits only in the raw stream events.
    const usage = { input_tokens: 0, output_tokens: 5, total_tokens: 5 };
    const response = { id: "resp_1", status: "completed", output: [] };
    const placements: Record<string, Record<string, unknown>> = {
      "next to type": { type: "response.completed", response: { ...response, usage }, credits_consumed: 0.01 },
      "on the response": { type: "response.completed", response: { ...response, usage, credits_consumed: 0.01 } },
      "inside the response's usage": { type: "response.completed", response: { ...response, usage: { ...usage, credits_consumed: 0.01 } } },
      "inside a usage object next to type": { type: "response.completed", response: { ...response, usage }, usage: { credits_consumed: 0.01 } },
    };
    for (const [where, terminal] of Object.entries(placements)) {
      const { chat } = kit([{ method: "POST", url: KIE_RESPONSES_URL, respond: () => responsesStream(["OK"], terminal) }]);
      const last = await outcome(chat, turn({ provider: "kie", model: "gpt-6-sol" }));
      assert.equal(last.type, "done", where);
      const reported = last.type === "done" ? last.usage : undefined;
      assert.deepEqual([reported?.input, reported?.output], [0, 5], where);
      assert.deepEqual([reported?.costUsd, reported?.costSource], [0.00005, "provider"], where);
    }
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
    const last = await outcome(chat, turn({ provider: "kie", model: "gpt-5-6-sol" }));
    assert.equal(last.type === "failed" && last.error.code, "CONTENT_BLOCKED");
    assert.equal(last.type === "failed" && last.error.reason, "content_filter");
    assert.equal(last.type === "failed" && last.usage?.input, 5);
  });

  function maxTokensStop(text: string[]): Response {
    return responsesStream(text, {
      type: "response.incomplete",
      response: {
        id: "resp_1",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: { input_tokens: 5, output_tokens: 16, total_tokens: 21 },
      },
    });
  }

  it("ends a free-form answer cut off at max_output_tokens with done and truncated, keeping its text", async () => {
    const { chat } = kit([{ method: "POST", url: KIE_RESPONSES_URL, respond: () => maxTokensStop(["Once upon", " a ti"]) }]);
    const { events, message } = await runToEnd(chat, turn({ provider: "kie", model: "gpt-5-6-sol" }));
    assert.equal(textOf(events), "Once upon a ti");
    const last = outcomeOf(message);
    assert.equal(last.type === "done" && last.truncated, true);
    assert.equal(last.type === "done" && last.usage?.output, 16);
  });

  it("fails a response-schema answer cut off at max_output_tokens, with the raw stop reason", async () => {
    const { chat } = kit([{ method: "POST", url: KIE_RESPONSES_URL, respond: () => maxTokensStop(['{"ok":']) }]);
    const last = await outcome(chat, turn({ provider: "kie", model: "gpt-5-6-sol", responseSchema: { name: "verdict", schema: SCHEMA } }));
    assert.equal(last.type, "failed");
    if (last.type !== "failed") return;
    assert.equal(last.error.code, "PROVIDER_ERROR");
    assert.equal(last.error.reason, "incomplete.max_output_tokens");
    assert.match(last.error.message, /output-token limit/);
    assert.equal(last.usage?.output, 16);
  });
});

describe("streamSimple on OpenAI Responses: ambient configuration", () => {
  const ROUTES = [
    { provider: "kie", model: "gpt-5-6-sol", url: KIE_RESPONSES_URL, key: "kie-key" },
    { provider: "toapis", model: "gpt-5.3-codex-official", url: "https://toapis.com/v1/responses", key: "t-key" },
  ] as const;

  for (const route of ROUTES) {
    it(`sends no OpenAI organisation or project header from the environment, on ${route.provider}`, async () => {
      await withEnv({ OPENAI_ORG_ID: "org-from-env", OPENAI_PROJECT_ID: "proj-from-env" }, async () => {
        const fake = createFakeFetch([
          {
            method: "POST",
            url: route.url,
            respond: () => responsesStream(["ok"], { type: "response.completed", response: { id: "resp_1", status: "completed", output: [] } }),
          },
        ]);
        const chat = testKit([route.provider], wireFetch(fake));
        assert.equal((await outcome(chat, turn({ provider: route.provider, model: route.model }))).type, "done");
        const headers = fake.calls.find((call) => call.method === "POST")?.headers ?? {};
        assert.equal(headers["openai-organization"], undefined);
        assert.equal(headers["openai-project"], undefined);
        assert.equal(headers.authorization, `Bearer ${route.key}`);
      });
    });
  }
});
