# @hk01/pi-ai-extra-chat-kit

Server-only chat kit on `@earendil-works/pi-ai`. `createChatKit({ providers })` registers the chat providers you build with the provider packages' factories (each bound to its own key), `streamSimple()` and `completeSimple()` run one turn from pi-ai's `Context` on exactly the provider and model you name (`{ provider, id }`), streaming pi-ai's events, and `listModels()` lists each provider's live models as pi-ai `Model`s. Every provider gets the same extras pi-ai lacks: reference documents (text, PDF, images), a JSON response schema, safety-block reporting, a usage record with the turn's cost (provider-reported, or estimated from the model's dated rate), and tools that pass through to pi-ai. It never chooses a provider and never falls back.

- ESM only (pi-ai is ESM-only). No browser or React entry: never import it from browser code.
- Peers: `@earendil-works/pi-ai@1.2.0`, and the provider packages you register (optional each): `@hk01/pi-ai-extra-google` (0.6+), `@hk01/pi-ai-extra-openrouter` (0.1+), `@hk01/pi-ai-extra-kie` and `@hk01/pi-ai-extra-toapis` (0.5+).

```ts
import { createChatKit } from "@hk01/pi-ai-extra-chat-kit";
import { createGoogleProvider } from "@hk01/pi-ai-extra-google/pi-ai";

const chat = createChatKit({ providers: [createGoogleProvider({ apiKey: process.env.GEMINI_API_KEY! })] });

const stream = chat.streamSimple({ provider: "google", id: "gemini-3.5-flash" }, { systemPrompt, messages }, { documents });
for await (const event of stream) if (event.type === "text_delta") res.write(event.delta);
const message = await stream.result();
if (message.stopReason === "error") showError(message.chatKit.error.code); // CONTENT_BLOCKED, PROVIDER_ERROR, UNSUPPORTED, ...
```

A turn never throws: every failure is a final `error` event and a `stopReason: "error"` message. One kit per tenant: two keys for the same provider are two kits. Install the pinned GitHub Release asset (`chat-kit-vX.Y.Z`). The full guide covers providers, model lists, documents, response schemas, tools, errors, usage and cost, prompt caching, and upgrading from 0.2: https://github.com/kpkonghk01/pi-ai-extra#chat-kit
