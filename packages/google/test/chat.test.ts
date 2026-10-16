import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { GOOGLE_IMAGE_MODELS } from "../src/index.ts";
import { assertModelRate, ratePeriodAt } from "@hk01/pi-ai-extra-internal/pi-ai";
import { createGoogleProvider, GEMINI_CHAT_RATES, GOOGLE_CHAT_MODEL_IDS, googleChatRate } from "../src/pi-ai/index.ts";

describe("createGoogleProvider", () => {
  it("uses only the explicit key, never GEMINI_API_KEY", async () => {
    assert.throws(() => createGoogleProvider({ apiKey: " " }), /apiKey is required/);
    const provider = createGoogleProvider({ apiKey: "explicit-key" });
    const resolved = await provider.auth.apiKey?.resolve({
      ctx: { env: async (name) => (name === "GEMINI_API_KEY" ? "env-key" : undefined), fileExists: async () => false },
      signal: new AbortController().signal,
    });
    assert.equal(resolved?.auth.apiKey, "explicit-key");
  });

  it("serves pi-ai's Gemini catalogue, with Google list prices for models outside the rate table", () => {
    const provider = createGoogleProvider({ apiKey: "k" });
    assert.equal(provider.id, "google");
    assert.deepEqual(
      provider.getModels().map((model) => model.id),
      Object.keys(GOOGLE_MODELS),
    );
    const flash = provider.getModels().find((model) => model.id === "gemini-3.5-flash");
    assert.equal(flash?.api, "google-generative-ai");
    assert.deepEqual(flash?.cost, GOOGLE_MODELS["gemini-3.5-flash"].cost);
    assert.ok((flash?.cost.input ?? 0) > 0);
  });

  it("restricts to chosen ids, rejects unknown ones, and applies a base URL override", () => {
    const provider = createGoogleProvider({ apiKey: "k", modelIds: ["gemini-3.5-flash", "gemini-2.5-pro"], baseUrl: "https://proxy.example.com/v1beta/" });
    assert.deepEqual(provider.getModels().map((model) => model.id).sort(), ["gemini-2.5-pro", "gemini-3.5-flash"]);
    assert.ok(provider.getModels().every((model) => model.baseUrl === "https://proxy.example.com/v1beta"));
    assert.throws(() => createGoogleProvider({ apiKey: "k", modelIds: ["gemini-9-ultra"] }), /unknown chat model id\(s\) gemini-9-ultra/);
    assert.ok(GOOGLE_CHAT_MODEL_IDS.includes("gemini-3.5-flash"));
  });

  it("registers in pi-ai Models alongside the other providers, with chat and image models", () => {
    const models = createModels();
    models.setProvider(createGoogleProvider({ apiKey: "k", modelIds: ["gemini-3.5-flash"] }));
    assert.equal(models.getModel("google", "gemini-3.5-flash")?.provider, "google");
    assert.deepEqual(
      models.getModelsOfType("image", "google").map((model) => model.id),
      GOOGLE_IMAGE_MODELS.map((model) => model.id),
    );
    assert.equal(models.getModel("google", "gemini-3-pro-image"), undefined);
  });

  it("prices models in the rate table from the period in force when the provider is created", () => {
    const flash = createGoogleProvider({ apiKey: "k" }).getModels().find((model) => model.id === "gemini-3.8-flash");
    const doubled = Date.now() >= Date.parse("2027-01-01T00:00:00Z");
    // Gemini publishes no per-token cache-write price: the cache fill-in rule derives 1.25 × input.
    assert.deepEqual(
      flash?.cost,
      doubled ? { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.875 } : { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.9375 },
    );
    const pro = createGoogleProvider({ apiKey: "k" }).getModels().find((model) => model.id === "gemini-3.1-pro-preview");
    assert.deepEqual(pro?.cost.tiers, [{ inputTokensAbove: 200_000, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5 }]);
  });
});

describe("Gemini chat rates", () => {
  it("ports the portal's text-model schedule, with cached-input rates where Google publishes them", () => {
    for (const [id, rate] of Object.entries(GEMINI_CHAT_RATES)) assert.doesNotThrow(() => assertModelRate(rate, id));
    const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
    for (const id of ["gemini-3.8-flash", "gemini-3.7-flash"]) {
      assert.deepEqual(ratePeriodAt(GEMINI_CHAT_RATES[id]!, at("2026-12-31")), {
        input: 0.75,
        output: 3.75,
        ...(id === "gemini-3.8-flash" ? { cacheRead: 0.075 } : {}),
      });
      assert.equal(ratePeriodAt(GEMINI_CHAT_RATES[id]!, at("2027-01-01"))?.output, 7.5, `${id} doubles on 2027-01-01`);
    }
    assert.deepEqual(GEMINI_CHAT_RATES["gemini-3.1-pro-preview"]?.periods[0]?.largePrompt, {
      overPromptTokens: 200_000,
      input: 4,
      output: 18,
      cacheRead: 0.4,
    });
    assert.deepEqual(GEMINI_CHAT_RATES["gemini-3.5-flash-lite"]?.periods, [{ input: 0.3, output: 2.5, cacheRead: 0.03 }]);
    assert.deepEqual(GEMINI_CHAT_RATES["gemini-3.1-flash-lite"]?.periods, [{ input: 0.25, output: 1.5, cacheRead: 0.025 }]);
  });

  it("takes a -preview id's rate from the id without the suffix, unless the preview has its own", () => {
    assert.equal(googleChatRate("gemini-3.1-flash-lite-preview"), GEMINI_CHAT_RATES["gemini-3.1-flash-lite"]);
    assert.equal(googleChatRate("gemini-3.1-pro-preview"), GEMINI_CHAT_RATES["gemini-3.1-pro-preview"]);
  });

  it("falls back to pi-ai's catalogue price for an id outside the table, and has no rate otherwise", () => {
    assert.deepEqual(googleChatRate("gemini-3.5-flash"), { periods: [{ input: 1.5, output: 9, cacheRead: 0.15 }] });
    assert.deepEqual(googleChatRate("gemini-2.5-pro")?.periods[0]?.largePrompt, {
      overPromptTokens: 200_000,
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
    });
    assert.equal(googleChatRate("gemma-4-31b-it"), undefined, "a zero catalogue price is no rate");
    assert.equal(googleChatRate("gemini-9-ultra"), undefined);
  });
});
