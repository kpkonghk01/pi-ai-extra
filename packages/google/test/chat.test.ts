import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { createGoogleProvider, GOOGLE_CHAT_MODEL_IDS } from "../src/pi-ai/index.ts";

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

  it("serves pi-ai's Gemini catalogue unchanged, including Google list prices", () => {
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

  it("registers in pi-ai Models alongside the other providers", () => {
    const models = createModels();
    models.setProvider(createGoogleProvider({ apiKey: "k" }));
    assert.equal(models.getModel("google", "gemini-3.5-flash")?.provider, "google");
  });
});
