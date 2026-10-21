import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertModelRate,
  buildChatModel,
  catalogueRate,
  modelCostAt,
  ratePeriodAt,
  roundRate,
  singleRate,
  toModelCost,
  type ModelRate,
} from "../src/pi-ai/index.ts";

/** A schedule shaped like Gemini 3.8 Flash's: every rate doubles on 2027-01-01. */
const DOUBLING: ModelRate = {
  periods: [
    { input: 0.75, output: 3.75, cacheRead: 0.075 },
    { from: "2027-01-01", input: 1.5, output: 7.5, cacheRead: 0.15 },
  ],
};

/** A schedule shaped like Gemini 3.1 Pro's: higher rates for the whole request over 200k prompt tokens. */
const TIERED: ModelRate = singleRate({
  input: 2,
  output: 12,
  cacheRead: 0.2,
  largePrompt: { overPromptTokens: 200_000, input: 4, output: 18, cacheRead: 0.4 },
});

describe("toModelCost", () => {
  it("keeps every published rate", () => {
    assert.deepEqual(toModelCost({ input: 2.8, output: 14, cacheRead: 0.28, cacheWrite: 3.5 }), {
      input: 2.8,
      output: 14,
      cacheRead: 0.28,
      cacheWrite: 3.5,
    });
  });

  it("prices unpublished cache reads at the input rate and cache writes at 1.25 × input", () => {
    assert.deepEqual(toModelCost({ input: 1.5, output: 7.5 }), { input: 1.5, output: 7.5, cacheRead: 1.5, cacheWrite: 1.875 });
  });

  it("fills in only the cache rate that is missing", () => {
    assert.deepEqual(toModelCost({ input: 1, output: 5, cacheRead: 0.1 }), { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
    assert.deepEqual(toModelCost({ input: 1, output: 5, cacheWrite: 2 }), { input: 1, output: 5, cacheRead: 1, cacheWrite: 2 });
  });

  it("rounds every rate, including a derived cache write, to drop floating-point noise", () => {
    // In binary floating point, 11.2 × 0.005 is 0.055999999999999994 and 1.12 × 0.005 is 0.005600000000000001.
    assert.notEqual(11.2 * 0.005, 0.056);
    assert.deepEqual(toModelCost({ input: 11.2 * 0.005, output: 67.2 * 0.005, cacheRead: 1.12 * 0.005, cacheWrite: 14 * 0.005 }), {
      input: 0.056,
      output: 0.336,
      cacheRead: 0.0056,
      cacheWrite: 0.07,
    });
    assert.deepEqual(toModelCost({ input: 11.2 * 0.005, output: 67.2 * 0.005 }), {
      input: 0.056,
      output: 0.336,
      cacheRead: 0.056,
      cacheWrite: 0.07,
    });
    assert.deepEqual(toModelCost({ input: 170 * 0.005, output: 855 * 0.005 }), { input: 0.85, output: 4.275, cacheRead: 0.85, cacheWrite: 1.0625 });
  });
});

describe("roundRate", () => {
  it("rounds a rate to 6 decimal places: KIE credits, ToAPIs ratios and OpenRouter per-token prices", () => {
    // In binary floating point, 11.2 × 0.005 is 0.055999999999999994 and 0.0000002 × 1M is 0.19999999999999998.
    assert.notEqual(11.2 * 0.005, 0.056);
    assert.equal(roundRate(11.2 * 0.005), 0.056);
    assert.notEqual(0.0000002 * 1_000_000, 0.2);
    assert.equal(roundRate(0.0000002 * 1_000_000), 0.2);
    assert.equal(roundRate(0.0000004), 0);
  });
});

describe("rate schedules", () => {
  it("switches to the next period at 00:00 UTC on its from day", () => {
    assert.equal(ratePeriodAt(DOUBLING, Date.parse("2026-12-31T23:59:59.999Z"))?.input, 0.75);
    assert.equal(ratePeriodAt(DOUBLING, Date.parse("2027-01-01T00:00:00Z"))?.input, 1.5);
    assert.equal(ratePeriodAt(DOUBLING, new Date("2030-06-01"))?.input, 1.5);
  });

  it("has no rate before the first period's day: a request is priced at the rate in force when it was made", () => {
    const dated: ModelRate = { periods: [{ from: "2027-01-01", input: 1, output: 2 }] };
    const before = Date.parse("2026-12-31T23:59:59.999Z");
    assert.equal(ratePeriodAt(dated, before), undefined);
    assert.equal(ratePeriodAt(dated, Date.parse("2027-01-01T00:00:00Z"))?.input, 1);
    assert.deepEqual(modelCostAt(dated, before), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, "pi-ai's placeholder, not a rate");
    assert.equal(ratePeriodAt({ periods: [] }, Date.now()), undefined);
  });

  it("feeds pi-ai's Model.cost from the period in force, with the large-prompt tier as a pi-ai tier", () => {
    assert.deepEqual(modelCostAt(DOUBLING, Date.parse("2026-10-16T00:00:00Z")), { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.9375 });
    assert.deepEqual(modelCostAt(DOUBLING, Date.parse("2027-01-01T00:00:00Z")), { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.875 });
    assert.deepEqual(modelCostAt(TIERED, Date.now()), {
      input: 2,
      output: 12,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      tiers: [{ inputTokensAbove: 200_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }],
    });
    assert.deepEqual(modelCostAt(undefined, Date.now()), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, "pi-ai's placeholder, not a rate");
  });

  it("rejects an invalid schedule", () => {
    const invalid = (rate: unknown) => () => assertModelRate(rate as ModelRate, "test");
    assert.throws(invalid({ periods: [] }), /at least one period/);
    assert.throws(invalid({ periods: [{ input: 1, output: 1 }, { input: 2, output: 2 }] }), /periods\[1\] needs a from date/);
    assert.throws(invalid({ periods: [{ input: 1, output: 1 }, { from: "1 Jan 2027", input: 2, output: 2 }] }), /is not a YYYY-MM-DD date/);
    assert.throws(
      invalid({ periods: [{ from: "2027-01-01", input: 1, output: 1 }, { from: "2026-01-01", input: 2, output: 2 }] }),
      /must be later than the period before it/,
    );
    assert.throws(invalid({ periods: [{ input: -1, output: 1 }] }), /input must be a non-negative number/);
    assert.throws(invalid({ periods: [{ input: 1, output: 1, largePrompt: { overPromptTokens: 0, input: 2, output: 2 } }] }), /overPromptTokens/);
    assert.doesNotThrow(invalid(DOUBLING));
    assert.doesNotThrow(invalid(TIERED));
    assert.throws(
      () => buildChatModel("kie", "https://api.kie.ai/anthropic", { id: "claude-x", protocol: "anthropic-messages", rate: { periods: [] } }),
      /kie chat model claude-x: invalid rate/,
    );
  });
});

describe("catalogueRate", () => {
  it("reads a pi-ai catalogue price as one period, a zero cache rate as unpublished and an all-zero price as no rate", () => {
    assert.deepEqual(catalogueRate({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 }), { periods: [{ input: 3, output: 15, cacheRead: 0.3 }] });
    assert.deepEqual(
      catalogueRate({
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: 0,
        tiers: [{ inputTokensAbove: 200_000, input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 }],
      }),
      { periods: [{ input: 1.25, output: 10, cacheRead: 0.125, largePrompt: { overPromptTokens: 200_000, input: 2.5, output: 15, cacheRead: 0.25 } }] },
    );
    assert.equal(catalogueRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), undefined);
    assert.equal(catalogueRate(undefined), undefined);
  });
});
