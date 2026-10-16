import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillCacheRates } from "../src/pi-ai/index.ts";

describe("fillCacheRates", () => {
  it("keeps every published rate", () => {
    assert.deepEqual(fillCacheRates({ input: 2.8, output: 14, cacheRead: 0.28, cacheWrite: 3.5 }), {
      input: 2.8,
      output: 14,
      cacheRead: 0.28,
      cacheWrite: 3.5,
    });
  });

  it("prices unpublished cache reads at the input rate and cache writes at 1.25 × input", () => {
    assert.deepEqual(fillCacheRates({ input: 1.5, output: 7.5 }), { input: 1.5, output: 7.5, cacheRead: 1.5, cacheWrite: 1.875 });
  });

  it("fills in only the cache rate that is missing", () => {
    assert.deepEqual(fillCacheRates({ input: 1, output: 5, cacheRead: 0.1 }), { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 });
    assert.deepEqual(fillCacheRates({ input: 1, output: 5, cacheWrite: 2 }), { input: 1, output: 5, cacheRead: 1, cacheWrite: 2 });
  });

  it("rounds every rate, including a derived cache write, to drop floating-point noise", () => {
    // In binary floating point, 11.2 × 0.005 is 0.055999999999999994 and 1.12 × 0.005 is 0.005600000000000001.
    assert.notEqual(11.2 * 0.005, 0.056);
    assert.deepEqual(fillCacheRates({ input: 11.2 * 0.005, output: 67.2 * 0.005, cacheRead: 1.12 * 0.005, cacheWrite: 14 * 0.005 }), {
      input: 0.056,
      output: 0.336,
      cacheRead: 0.0056,
      cacheWrite: 0.07,
    });
    assert.deepEqual(fillCacheRates({ input: 11.2 * 0.005, output: 67.2 * 0.005 }), {
      input: 0.056,
      output: 0.336,
      cacheRead: 0.056,
      cacheWrite: 0.07,
    });
    assert.deepEqual(fillCacheRates({ input: 170 * 0.005, output: 855 * 0.005 }), { input: 0.85, output: 4.275, cacheRead: 0.85, cacheWrite: 1.0625 });
  });
});
