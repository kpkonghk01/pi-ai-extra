# @hk01/pi-ai-extra-kie

Server-only extension to `@earendil-works/pi-ai`: KIE chat (Codex and Claude, a chat provider with a live model list) and image generation. Image models: Grok Imagine Image 2.0 (`grok-imagine-image-2-0/text-to-image`, `grok-imagine-image-2-0/image-edit`), GPT Image 2 (`gpt-image-2-text-to-image`, `gpt-image-2-image-to-image`) and Nano Banana 2 (`nano-banana-2`). Each paired text/edit operation shares one catalogue `familyId` (`grok-imagine-image-2-0`, `gpt-image-2`).

- Main entry (CommonJS and ESM): `generateKieImage()`, `getKieTask()`, `KIE_IMAGE_MODELS`, `PiAiExtraError` / `isPiAiExtraError`.
- `/pi-ai` subpath (ESM only, needs `@earendil-works/pi-ai@1.2.0`): `createKieProvider()`, one chat provider (a pi-ai `Provider` with the chat kit's `chatKit` traits and a live model list) serving the chat models and `KIE_IMAGE_MODELS` (image settings in `imageSettings`).

Chat: Codex (`gpt-6-1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5-6-sol`, `gpt-5-6-terra`, `gpt-5-6-luna`) on OpenAI Responses (`https://api.kie.ai/openai/v1`) and Claude (5.5, 5 and 4.x) on Anthropic Messages (`https://api.kie.ai/anthropic`, Bearer auth). Each chat model carries KIE's published `rate` (USD per 1M tokens). Usage: `creditsConsumed` and `costTime` (ms).

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

API keys are always explicit arguments; the package never reads a key or setting of its own from environment variables (the SDKs underneath read a few; the [root README](https://github.com/kpkonghk01/pi-ai-extra#chat-providers-and-createchatkit) lists them) and must not be imported into browser code. There is no provider, model or storage fallback, and reference images over a model's limit are rejected, never dropped.

Install the pinned GitHub Release asset (`kie-vX.Y.Z`). The full guide covers options, errors, usage/billing, pi-ai integration and Google AI Studio setup: https://github.com/kpkonghk01/pi-ai-extra#readme
