import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderStreams } from "@earendil-works/pi-ai";
import { withDefaultFetch } from "../src/pi-ai/index.ts";

describe("withDefaultFetch", () => {
  it("fills in a fetch for a request without one, and leaves a request's own", () => {
    const seen: unknown[] = [];
    const inner = { stream: () => undefined, streamSimple: (_m: unknown, _c: unknown, options: { fetch?: unknown }) => void seen.push(options.fetch) } as unknown as ProviderStreams;
    const fetchA = (async () => new Response()) as typeof fetch;
    const fetchB = (async () => new Response()) as typeof fetch;
    const wrapped = withDefaultFetch(inner, fetchA);
    wrapped.streamSimple({} as never, {} as never, undefined);
    wrapped.streamSimple({} as never, {} as never, { fetch: fetchB });
    assert.deepEqual(seen, [fetchA, fetchB]);
    assert.equal(withDefaultFetch(inner, undefined), inner);
  });
});
