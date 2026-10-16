import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeFetch } from "@hk01/pi-ai-extra-internal/testing";
import {
  createChatKit,
  type ChatKitOptions,
  type ChatTurnError,
  type ChatTurnErrorCode,
  type ChatTurnEvent,
  type ChatTurnInput,
} from "../src/index.ts";
import { collect, testDocument, turn } from "./helpers.ts";

const PROVIDERS: ChatKitOptions["providers"] = [
  { name: "gemini", provider: "google", apiKey: "g-key" },
  { name: "router", provider: "openrouter", apiKey: "or-key" },
  { name: "kie", provider: "kie", apiKey: "kie-key" },
  { name: "toapis", provider: "toapis", apiKey: "t-key" },
];

/** A kit whose fetch fails the test if anything is sent. */
function offlineKit() {
  const fake = createFakeFetch([]);
  return { chat: createChatKit({ providers: PROVIDERS, fetch: fake.fetch }), fake };
}

async function failure(
  input: ChatTurnInput,
  signal?: AbortSignal,
): Promise<{ code: ChatTurnErrorCode; message: string; error: ChatTurnError; events: ChatTurnEvent[] }> {
  const { chat, fake } = offlineKit();
  const events = await collect(chat.runTurn(input, { signal }));
  assert.equal(events.length, 1, "a failure found before sending is the only event");
  const event = events[0];
  assert.equal(event?.type, "failed");
  assert.equal(fake.calls.length, 0, "nothing was sent");
  if (event?.type !== "failed") throw new Error("unreachable");
  assert.equal(event.usage, undefined);
  return { code: event.error.code, message: event.error.message, error: event.error, events };
}

describe("createChatKit configuration", () => {
  it("throws for an unknown provider, a duplicate name, a missing key and grounding outside Google", () => {
    assert.throws(
      () => createChatKit({ providers: [{ name: "x", provider: "wokey" as never, apiKey: "k" }] }),
      /providers\[0\]\.provider: unknown provider "wokey"; expected one of google, openrouter, kie, toapis/,
    );
    assert.throws(
      () =>
        createChatKit({
          providers: [
            { name: "gemini", provider: "google", apiKey: "a" },
            { name: "gemini", provider: "google", apiKey: "b" },
          ],
        }),
      /duplicate provider name "gemini"/,
    );
    assert.throws(
      () => createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: " " }] }),
      /providers\[0\]\.apiKey: must not be empty/,
    );
    assert.throws(
      () => createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "k", grounding: true }] }),
      /grounding is supported only for provider "google"/,
    );
    assert.throws(
      () => createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "k", api_key: "x" } as never] }),
      /Unrecognized key/,
    );
    assert.throws(() => createChatKit({ providers: [{ name: "kie", provider: "kie", apiKey: "k", baseUrl: "ftp://x" }] }), /baseUrl/);
  });

  it("lets two names share a provider kind, each with its own key", () => {
    assert.doesNotThrow(() =>
      createChatKit({
        providers: [
          { name: "gemini", provider: "google", apiKey: "a" },
          { name: "gemini-backup-key", provider: "google", apiKey: "b", grounding: true },
        ],
      }),
    );
  });
});

describe("runTurn failures before anything is sent", () => {
  it("UNKNOWN_MODEL for an unconfigured provider name or a model outside the catalogue", async () => {
    const unknownProvider = await failure(turn({ provider: "nope" }));
    assert.equal(unknownProvider.code, "UNKNOWN_MODEL");
    assert.equal(unknownProvider.message, '[nope/openai/gpt-4o-mini] No provider named "nope" is configured.');
    assert.equal(unknownProvider.error.provider, "nope", "the consumer's provider name, as the turn gave it");
    assert.equal(unknownProvider.error.model, "openai/gpt-4o-mini");
    const unknownModel = await failure(turn({ provider: "gemini", model: "gemini-9-ultra" }));
    assert.equal(unknownModel.code, "UNKNOWN_MODEL");
    assert.equal(unknownModel.message, '[gemini/gemini-9-ultra] Model "gemini-9-ultra" is not in the google chat catalogue.');
    assert.equal((await failure(turn({ provider: "kie", model: "gpt-5.3-codex" }))).code, "UNKNOWN_MODEL");
  });

  it("UNSUPPORTED for PDFs or images on KIE and ToAPIs, an unknown type, or a text-only model", async () => {
    const pdf = testDocument("brief.pdf", "application/pdf", "%PDF");
    const kie = await failure(turn({ provider: "kie", model: "claude-sonnet-4-6", documents: [pdf] }));
    assert.equal(kie.code, "UNSUPPORTED");
    assert.match(kie.message, /Provider kie does not take PDF or image documents yet/);
    assert.equal(
      (await failure(turn({ provider: "toapis", model: "claude-haiku-4-5", documents: [testDocument("a.png", "image/png", "x")] }))).code,
      "UNSUPPORTED",
    );
    const docx = await failure(
      turn({ documents: [testDocument("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x")] }),
    );
    assert.equal(docx.code, "UNSUPPORTED");
    assert.match(docx.message, /supported types are text\/plain, text\/markdown/);
    const textOnly = await failure(turn({ model: "aion-labs/aion-2.0", documents: [pdf] }));
    assert.equal(textOnly.code, "UNSUPPORTED");
    assert.match(textOnly.message, /takes text only/);
    assert.equal(pdf.loads, 0, "nothing is loaded for a rejected request");
  });

  it("INVALID_REQUEST for malformed input or a document that cannot be loaded", async () => {
    const badSettings = await failure({ ...turn(), settings: { maxTokens: 5 } as never });
    assert.equal(badSettings.code, "INVALID_REQUEST");
    assert.match(badSettings.message, /input\.settings: Unrecognized key: "maxTokens"/);
    const badSchemaName = await failure(turn({ responseSchema: { name: "has space", schema: {} } }));
    assert.match(badSchemaName.message, /input\.responseSchema\.name: must be 1-64 letters/);
    const missing = {
      name: "gone.md",
      mimeType: "text/markdown",
      load: async (): Promise<Uint8Array> => {
        throw new Error("blob not found");
      },
    };
    const unloadable = await failure(turn({ documents: [missing] }));
    assert.equal(unloadable.code, "INVALID_REQUEST");
    assert.match(unloadable.message, /Document "gone.md" could not be loaded: blob not found/);
  });

  it("ABORTED when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal((await failure(turn(), controller.signal)).code, "ABORTED");
  });

  it("never throws, even for input that is not an object", async () => {
    const { chat } = offlineKit();
    const events = await collect(chat.runTurn(null as never));
    const event = events[0];
    assert.equal(event?.type, "failed");
    if (event?.type !== "failed") return;
    assert.equal(event.error.code, "INVALID_REQUEST");
    assert.equal(event.error.provider, "?");
    assert.equal(event.error.model, "?");
    assert.match(event.error.message, /^\[\?\/\?\] /);
  });
});
