import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAnthropicObserver } from "../src/wire/anthropic-messages.ts";
import { createGoogleObserver } from "../src/wire/google.ts";
import { createOpenAICompletionsObserver } from "../src/wire/openai-completions.ts";
import { createOpenAIResponsesObserver } from "../src/wire/openai-responses.ts";

/** The final pi-ai message of a turn, with the stop reasons pi-ai sets. */
function message(stopReason: AssistantMessage["stopReason"], rawStopReason?: string, errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "test",
    provider: "test",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(rawStopReason === undefined ? {} : { rawStopReason }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: 0,
  };
}

describe("Gemini block classification", () => {
  for (const reason of ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]) {
    it(`treats finish reason ${reason} as a content block`, () => {
      assert.equal(createGoogleObserver().blocked(message("error", reason))?.reason, reason);
    });
  }

  it("does not treat RECITATION, OTHER or MAX_TOKENS as a content block", () => {
    const observer = createGoogleObserver();
    assert.equal(observer.blocked(message("error", "RECITATION")), undefined);
    assert.equal(observer.blocked(message("error", "OTHER")), undefined);
    assert.equal(observer.blocked(message("length", "MAX_TOKENS")), undefined);
  });

  it("finds a prompt-level block in the raw chunk, where pi-ai reports only a missing finish reason", () => {
    const observer = createGoogleObserver();
    observer.observe({ promptFeedback: { blockReason: "BLOCKLIST" }, usageMetadata: { promptTokenCount: 7, totalTokenCount: 7 } });
    const blocked = observer.blocked(message("error", undefined, "Google stream ended without a finish reason"));
    assert.deepEqual(blocked, { reason: "BLOCKLIST", message: "Gemini blocked the prompt (BLOCKLIST)." });
    // Gemini leaves zero-valued counters out: the blocked prompt has no answer count, so none is reported.
    assert.deepEqual(observer.usage(), {
      inputTokens: 7,
      totalTokens: 7,
      raw: { usageMetadata: { promptTokenCount: 7, totalTokenCount: 7 } },
    });
  });

  it("reports no usage when no chunk carried usageMetadata", () => {
    const observer = createGoogleObserver();
    observer.observe({ candidates: [] });
    assert.equal(observer.usage(), undefined);
  });

  it("takes thinking tokens as part of the answer and reports them, and the cached prompt tokens", () => {
    const observer = createGoogleObserver();
    const usageMetadata = {
      promptTokenCount: 50,
      cachedContentTokenCount: 40,
      candidatesTokenCount: 6,
      thoughtsTokenCount: 4,
      totalTokenCount: 60,
    };
    observer.observe({ usageMetadata });
    assert.deepEqual(observer.usage(), {
      inputTokens: 50,
      outputTokens: 10,
      cachedInputTokens: 40,
      reasoningTokens: 4,
      totalTokens: 60,
      raw: { usageMetadata },
    });
  });

  it("counts grounding's tool-use prompt tokens as input", () => {
    const observer = createGoogleObserver();
    const usageMetadata = { promptTokenCount: 50, toolUsePromptTokenCount: 120, candidatesTokenCount: 6, totalTokenCount: 176 };
    observer.observe({ usageMetadata });
    assert.deepEqual(observer.usage(), { inputTokens: 170, outputTokens: 6, totalTokens: 176, raw: { usageMetadata } });
  });

  it("sums only the answer counts Gemini reported, and omits the answer count when it reported neither", () => {
    const thinking = createGoogleObserver();
    thinking.observe({ usageMetadata: { promptTokenCount: 9, thoughtsTokenCount: 4, totalTokenCount: 13 } });
    assert.deepEqual(thinking.usage(), {
      inputTokens: 9,
      outputTokens: 4,
      reasoningTokens: 4,
      totalTokens: 13,
      raw: { usageMetadata: { promptTokenCount: 9, thoughtsTokenCount: 4, totalTokenCount: 13 } },
    });
    const promptOnly = createGoogleObserver();
    promptOnly.observe({ usageMetadata: { promptTokenCount: 9 } });
    assert.deepEqual(promptOnly.usage(), { inputTokens: 9, raw: { usageMetadata: { promptTokenCount: 9 } } });
  });
});

describe("OpenAI Completions block classification", () => {
  it("treats finish_reason content_filter as a content block, and nothing else", () => {
    const observer = createOpenAICompletionsObserver();
    assert.equal(observer.blocked(message("error", "content_filter"))?.reason, "content_filter");
    assert.equal(observer.blocked(message("error", "network_error")), undefined);
    assert.equal(observer.blocked(message("length", "length")), undefined);
  });

  it("keeps the usage object, with OpenRouter's cost inside it", () => {
    const observer = createOpenAICompletionsObserver();
    observer.observe({ choices: [{ delta: { content: "x" } }] });
    observer.observe({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.01 } });
    assert.deepEqual(observer.usage(), {
      inputTokens: 1,
      outputTokens: 2,
      raw: { usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.01 } },
    });
  });

  it("keeps the reported cost when a token count is missing, or when no count was reported at all", () => {
    const promptOnly = createOpenAICompletionsObserver();
    promptOnly.observe({ choices: [], usage: { prompt_tokens: 7, cost: 0.002 } });
    assert.deepEqual(promptOnly.usage(), { inputTokens: 7, raw: { usage: { prompt_tokens: 7, cost: 0.002 } } });
    const costOnly = createOpenAICompletionsObserver();
    costOnly.observe({ choices: [], usage: { cost: 0.002 } });
    assert.deepEqual(costOnly.usage(), { raw: { usage: { cost: 0.002 } } });
  });

  it("reports no usage for a usage object with no count and no cost", () => {
    const observer = createOpenAICompletionsObserver();
    observer.observe({ choices: [], usage: { prompt_tokens: null, is_byok: false } });
    assert.equal(observer.usage(), undefined);
  });

  it("reads OpenRouter's cache reads and writes, both part of prompt_tokens", () => {
    const observer = createOpenAICompletionsObserver();
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 30 },
    };
    observer.observe({ choices: [], usage });
    assert.deepEqual(observer.usage(), {
      inputTokens: 100,
      outputTokens: 5,
      cachedInputTokens: 60,
      cacheWriteTokens: 30,
      totalTokens: 105,
      raw: { usage },
    });
  });
});

describe("Anthropic Messages block classification", () => {
  it("treats stop reasons refusal and sensitive as content blocks, with Claude's explanation", () => {
    const observer = createAnthropicObserver();
    assert.deepEqual(observer.blocked(message("error", "refusal", "Cannot help with that")), {
      reason: "refusal",
      message: "Claude stopped with refusal: Cannot help with that",
    });
    assert.equal(observer.blocked(message("error", "sensitive"))?.reason, "sensitive");
    assert.equal(observer.blocked(message("length", "max_tokens")), undefined);
    assert.equal(observer.blocked(message("stop", "end_turn")), undefined);
  });

  it("overlays message_delta usage on message_start usage and keeps credit fields", () => {
    const observer = createAnthropicObserver();
    observer.observe({ type: "message_start", message: { id: "m", usage: { input_tokens: 9, output_tokens: 1 } } });
    observer.observe({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5, input_tokens: null },
      credits_consumed: 0.2,
    });
    // Anthropic reports no total, and the kit never computes one.
    assert.deepEqual(observer.usage(), {
      inputTokens: 9,
      outputTokens: 5,
      raw: { usage: { input_tokens: 9, output_tokens: 5 }, credits_consumed: 0.2 },
    });
  });

  it("keeps KIE's credits_consumed when the answer count is missing", () => {
    const observer = createAnthropicObserver();
    observer.observe({ type: "message_start", message: { id: "m", usage: { input_tokens: 9 } } });
    observer.observe({ type: "message_delta", delta: { stop_reason: "end_turn" }, credits_consumed: 0.2 });
    assert.deepEqual(observer.usage(), { inputTokens: 9, raw: { usage: { input_tokens: 9 }, credits_consumed: 0.2 } });
  });

  it("adds the reported cache reads and writes to input_tokens, and ignores counts that are not token counts", () => {
    const observer = createAnthropicObserver();
    const usage = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: "7" };
    observer.observe({ type: "message_start", message: { id: "m", usage } });
    assert.deepEqual(observer.usage(), { inputTokens: 40, outputTokens: 2, cachedInputTokens: 30, raw: { usage } });
  });
});

describe("OpenAI Responses block classification", () => {
  it("treats an incomplete content_filter response and a streamed refusal as content blocks", () => {
    assert.equal(createOpenAIResponsesObserver().blocked(message("error", "incomplete.content_filter"))?.reason, "content_filter");
    const refusing = createOpenAIResponsesObserver();
    refusing.observe({ type: "response.refusal.delta", delta: "I can't" });
    assert.equal(refusing.blocked(message("stop", "completed"))?.reason, "refusal");
    assert.equal(createOpenAIResponsesObserver().blocked(message("length", "incomplete.max_output_tokens")), undefined);
  });

  it("keeps the terminal response's usage and credits, not the content", () => {
    const observer = createOpenAIResponsesObserver();
    observer.observe({ type: "response.created", response: { id: "r", usage: null } });
    observer.observe({
      type: "response.completed",
      response: { id: "r", output: [{ type: "message" }], usage: { input_tokens: 3, output_tokens: 1 }, credits_consumed: 0.48 },
    });
    assert.deepEqual(observer.usage(), {
      inputTokens: 3,
      outputTokens: 1,
      raw: { usage: { input_tokens: 3, output_tokens: 1 }, credits_consumed: 0.48 },
    });
  });

  it("keeps a prompt count and KIE's credits_consumed without an answer count", () => {
    const observer = createOpenAIResponsesObserver();
    observer.observe({ type: "response.completed", response: { id: "r", usage: { input_tokens: 3 }, credits_consumed: 0.48 } });
    assert.deepEqual(observer.usage(), { inputTokens: 3, raw: { usage: { input_tokens: 3 }, credits_consumed: 0.48 } });
  });

  it("keeps KIE's credits_consumed on a terminal response without a usage object", () => {
    const observer = createOpenAIResponsesObserver();
    observer.observe({ type: "response.completed", response: { id: "r", usage: null, credits_consumed: 0.48 } });
    assert.deepEqual(observer.usage(), { raw: { credits_consumed: 0.48 } });
  });

  it("reports no usage for a usage object with no count and no credits", () => {
    const observer = createOpenAIResponsesObserver();
    observer.observe({ type: "response.completed", response: { id: "r", usage: {} } });
    assert.equal(observer.usage(), undefined);
  });
});
