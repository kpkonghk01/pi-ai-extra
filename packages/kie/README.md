# @hk01/pi-ai-extra-kie

Server-only extension to `@earendil-works/pi-ai`: KIE chat (Codex, Claude and Gemini, a chat provider with a live model list) and image generation. Image models: Grok Imagine Image 2.0 (`grok-imagine-image-2-0/text-to-image`, `grok-imagine-image-2-0/image-edit`), GPT Image 2 (`gpt-image-2-text-to-image`, `gpt-image-2-image-to-image`) and Nano Banana 2.1 (`nano-banana-2-1`). Each paired text/edit operation shares one catalogue `familyId` (`grok-imagine-image-2-0`, `gpt-image-2`).

- Main entry (CommonJS and ESM): `generateKieImage()`, `getKieTask()`, `KIE_IMAGE_MODELS`, `PiAiExtraError` / `isPiAiExtraError`.
- `/pi-ai` subpath (ESM only, needs `@earendil-works/pi-ai@1.2.0`): `createKieProvider()`, one chat provider (a pi-ai `Provider` with the chat kit's `chatKit` traits and a live model list) serving the chat models and `KIE_IMAGE_MODELS` (image settings in `imageSettings`).

Chat: Codex (`gpt-6-1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5-6-sol`, `gpt-5-6-terra`, `gpt-5-6-luna`) on OpenAI Responses (`https://api.kie.ai/openai/v1`) and Claude (5.5, 5 and 4.x) on Anthropic Messages (`https://api.kie.ai/anthropic`, Bearer auth). Gemini (`gemini-3-8-flash`, `gemini-3-6-flash`, `gemini-4-argon`) on OpenAI Chat Completions, one base URL per model, in its definition (`https://api.kie.ai/<id>-openai/v1`), not on KIE's Gemini-native route ([ADR 0010](https://github.com/kpkonghk01/pi-ai-extra/blob/main/docs/adr/0010-kie-gemini-chat-completions-route.md)). Each chat model carries KIE's published `rate` (USD per 1M tokens). Usage: `creditsConsumed` and `costTime` (ms).

The Gemini models are offered from the package's definitions: no KIE model list names them, so a model KIE withdraws fails with KIE's own message. KIE sends no `finish_reason` on this route, so the package adds a `stop` one; a reply cut off at `maxTokens` therefore ends `stop` as well, and `output` in the usage record against the limit is the only sign. A turn's `reasoning` goes as `reasoning_effort`, which KIE takes as `low` or `high`: pi-ai sends the nearest of them (`minimal` and an explicit `off` as `low`; `medium`, `xhigh` and `max` as `high`), and none when the turn sets no level. A response schema goes as `response_format`; KIE takes the schema's shape but do not enforce it: in a live check on 2026-11-03, Gemini 3.8 Flash and 4 Argon answered JSON with the schema's keys and a value outside its `enum`; validate the answer. Gemini 4 Argon's replies carry `[cite: n]` markers. The Gemini rates are KIE's limited-time prices: 3.8 and 3.6 Flash change to KIE's published regular price on 2026-12-31; 4 Argon's price is valid until 2026-11-30, and KIE publishes no later one yet. A turn's cost is KIE's own charge either way.

```ts
import { generateKieImage } from "@hk01/pi-ai-extra-kie";

const result = await generateKieImage({
  apiKey: process.env.KIE_API_KEY!, // server-side secret, passed explicitly
  model: "gpt-image-2-image-to-image",
  prompt: "Restyle image 1 as a flat illustration",
  referenceImages: [sourceDataUrl],
  aspectRatio: "16:9",
  resolution: "2K",
});
const { dataUrl } = result.images[0]!;
```

API keys are always explicit arguments; the package never reads a key or setting of its own from environment variables (the SDKs underneath read a few; the [root README](https://github.com/kpkonghk01/pi-ai-extra#chat-providers-and-createchatkit) lists them, and says which the chat kit suppresses; used without the chat kit, none is suppressed) and must not be imported into browser code. There is no provider, model or storage fallback, and reference images over a model's limit are rejected, never dropped.

Install the pinned GitHub Release asset (`kie-vX.Y.Z`). The full guide covers options, errors, usage/billing, pi-ai integration and Google AI Studio setup: https://github.com/kpkonghk01/pi-ai-extra#readme
