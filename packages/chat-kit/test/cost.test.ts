import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GEMINI_CHAT_RATES } from "@hk01/pi-ai-extra-google/pi-ai";
import { createFakeFetch } from "@hk01/pi-ai-extra-internal/testing";
import { withCost, type TurnPricing } from "../src/cost.ts";
import { createChatKit, type ChatProviderKind, type ChatUsage } from "../src/index.ts";
import { PROVIDER_KIND_SPECS } from "../src/registry.ts";
import { anthropicEvents, collect, lastEvent, sseResponse, turn } from "./helpers.ts";

const BEFORE_DOUBLING = Date.parse("2026-12-31T23:59:59Z");
const AFTER_DOUBLING = Date.parse("2027-01-01T00:00:00Z");

function usage(fields: Omit<ChatUsage, "raw">, raw: Record<string, unknown> = {}): ChatUsage {
  return { ...fields, raw };
}

/** A turn on `kind`, priced by that kind's cost policy. */
function pricing(kind: ChatProviderKind, rate: TurnPricing["rate"], startedAt = BEFORE_DOUBLING): TurnPricing {
  return { policy: PROVIDER_KIND_SPECS[kind].cost, rate, startedAt };
}

const FLASH = GEMINI_CHAT_RATES["gemini-3.8-flash"];
const PRO = GEMINI_CHAT_RATES["gemini-3.1-pro-preview"];
const SONNET = { periods: [{ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }] };

describe("turn cost", () => {
  it("takes OpenRouter's reported usage.cost first, including a reported 0", () => {
    const reported = withCost(usage({ inputTokens: 100, outputTokens: 10 }, { usage: { cost: 0.0042 } }), pricing("openrouter", SONNET));
    assert.equal(reported?.costUsd, 0.0042);
    assert.equal(reported?.costSource, "provider");
    const free = withCost(usage({ inputTokens: 100 }, { usage: { cost: 0 } }), pricing("openrouter", SONNET));
    assert.deepEqual([free?.costUsd, free?.costSource], [0, "provider"]);
  });

  it("estimates an OpenRouter turn whose cost is missing or not a number", () => {
    const estimated = withCost(usage({ inputTokens: 1_000, outputTokens: 100 }, { usage: { cost: "n/a" } }), pricing("openrouter", SONNET));
    assert.deepEqual([estimated?.costUsd, estimated?.costSource], [0.0045, "estimated"]);
  });

  it("prices KIE from credits_consumed × $0.005, and never from its token counts", () => {
    const credited = withCost(usage({ inputTokens: 30, outputTokens: 4 }, { credits_consumed: 0.48 }), pricing("kie", SONNET));
    assert.deepEqual([credited?.costUsd, credited?.costSource], [0.0024, "provider"]);
    const uncredited = withCost(usage({ inputTokens: 30, outputTokens: 4 }, { usage: { input_tokens: 30 } }), pricing("kie", SONNET));
    assert.equal(uncredited?.costUsd, undefined);
    assert.equal(uncredited?.costSource, undefined);
  });

  it("estimates at the rate in force when the turn started: Gemini 3.8 Flash doubles on 2027-01-01", () => {
    const counts = usage({ inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 100_000 });
    assert.equal(withCost(counts, pricing("google", FLASH, BEFORE_DOUBLING))?.costUsd, 0.855);
    assert.equal(withCost(counts, pricing("google", FLASH, AFTER_DOUBLING))?.costUsd, 1.71);
  });

  it("estimates the whole request at the large-prompt tier over 200k prompt tokens (Gemini 3.1 Pro)", () => {
    assert.equal(withCost(usage({ inputTokens: 200_000, outputTokens: 1_000 }), pricing("google", PRO))?.costUsd, 0.412);
    assert.equal(withCost(usage({ inputTokens: 200_001, outputTokens: 1_000 }), pricing("google", PRO))?.costUsd, 0.818004);
  });

  it("omits the cost fields without a rate or without a count to price, never setting 0", () => {
    const unpriced = withCost(usage({ inputTokens: 10, outputTokens: 2 }), pricing("toapis", undefined));
    assert.equal("costUsd" in (unpriced ?? {}), false);
    assert.equal("costSource" in (unpriced ?? {}), false);
    const countless = withCost(usage({ cachedInputTokens: 5 }), pricing("google", FLASH));
    assert.equal("costUsd" in (countless ?? {}), false);
    assert.equal(withCost(undefined, pricing("google", FLASH)), undefined);
  });

  it("estimates a ToAPIs turn from its package rate, deriving the unpublished cache rates", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: /^https:\/\/toapis\.com\/v1\/messages\b/,
        respond: () => sseResponse(anthropicEvents({ blocks: [{ type: "text", text: "ok" }], stopReason: "end_turn" })),
      },
    ]);
    const chat = createChatKit({ providers: [{ name: "toapis", provider: "toapis", apiKey: "t-key" }], fetch: fake.fetch });
    const last = lastEvent(await collect(chat.runTurn(turn({ provider: "toapis", model: "claude-haiku-4-5" }))));
    assert.equal(last.type, "done");
    if (last.type !== "done") return;
    // claude-haiku-4-5 on ToAPIs: 0.3 in, 1.5 out; cache reads at the input rate, writes at 1.25 × input.
    // 20 uncached × 0.3 + 5 read × 0.3 + 7 written × 0.375 + 9 out × 1.5 = 23.625 per 1M tokens.
    assert.equal(last.usage?.costUsd, 0.000023625);
    assert.equal(last.usage?.costSource, "estimated");
  });
});
