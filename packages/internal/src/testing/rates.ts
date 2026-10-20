import assert from "node:assert/strict";

/** Expected rates of one chat model: `[input, output, cacheRead, cacheWrite]` in USD per 1M tokens. */
export type ExpectedRates = readonly [input: number, output: number, cacheRead: number, cacheWrite: number];

/**
 * Asserts a provider's chat models carry exactly these rates (pi-ai `Model.cost`): the same model
 * ids, and each model's input, output, cache-read and cache-write rate. Test-only.
 */
export function assertRateTable(
  models: readonly { id: string; cost: { input: number; output: number; cacheRead: number; cacheWrite: number } }[],
  expected: Readonly<Record<string, ExpectedRates>>,
): void {
  const cost = new Map(models.map((model) => [model.id, model.cost]));
  assert.deepEqual([...cost.keys()].sort(), Object.keys(expected).sort());
  for (const [id, [input, output, cacheRead, cacheWrite]] of Object.entries(expected)) {
    assert.deepEqual(cost.get(id), { input, output, cacheRead, cacheWrite }, id);
  }
}
