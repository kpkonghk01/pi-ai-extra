# @hk01/pi-ai-extra-chat-kit

Server-only chat kit on `@earendil-works/pi-ai`: `createChatKit()` registers Gemini, OpenRouter, KIE and ToAPIs with explicit keys, `listModels()` lists each provider's live models (read before the first turn, which waits up to 5 seconds for it, then again in the background once 30 minutes old; the installed catalogue is used while no live list could be read; image-output, router and moving-alias models are never offered), and `runTurn()` runs one chat turn on exactly the provider and model the consumer chose, with the same features on every provider: reference documents (text, PDF, images), a JSON response schema, safety-block reporting, provider-reported usage and the turn's cost (provider-reported, or estimated from the model's dated rate). It never chooses a provider and never falls back.

- ESM only (pi-ai is ESM-only). No browser or React entry: never import it from browser code.
- Peers: `@earendil-works/pi-ai@1.2.0`, `@hk01/pi-ai-extra-google` (0.5+), `@hk01/pi-ai-extra-kie` and `@hk01/pi-ai-extra-toapis` (0.4+).

```ts
import { createChatKit } from "@hk01/pi-ai-extra-chat-kit";

const chat = createChatKit({ providers: [{ name: "gemini", provider: "google", apiKey: process.env.GEMINI_API_KEY! }] });

for await (const event of chat.runTurn({ provider: "gemini", model: "gemini-3.5-flash", systemPrompt, documents, history, message })) {
  if (event.type === "text") res.write(event.delta);
  else if (event.type === "failed") showError(event.error); // CONTENT_BLOCKED, PROVIDER_ERROR, UNSUPPORTED, ...
}
```

A turn never throws: every failure is a final `failed` event. Install the pinned GitHub Release asset (`chat-kit-vX.Y.Z`). The full guide covers providers, model lists, documents, response schemas, errors, usage and cost, and prompt caching: https://github.com/kpkonghk01/pi-ai-extra#chat-kit
