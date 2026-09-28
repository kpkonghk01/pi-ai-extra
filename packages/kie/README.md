# @hk01/pi-ai-extra-kie

Server-only extension to `@earendil-works/pi-ai`: Grok Imagine Image 2.0 (`grok-imagine-image-2-0/text-to-image`, `grok-imagine-image-2-0/image-edit`), GPT Image 2 (`gpt-image-2-text-to-image`, `gpt-image-2-image-to-image`) and Nano Banana 2 (`nano-banana-2`).

- Main entry (CommonJS and ESM): `generateKieImage()`, `getKieTask()`, `KIE_IMAGE_MODELS`, `PiAiExtraError` / `isPiAiExtraError`.
- `/pi-ai` subpath (ESM only, needs `@earendil-works/pi-ai@0.87.1`): `createKieProvider()` (pi-ai `Models`) and `createKieImagesProvider()` (pi-ai `ImagesModels`).

Chat: GPT Codex on OpenAI Responses (`https://api.kie.ai/api/v1`) and Claude on Anthropic Messages (`https://api.kie.ai/claude`, Bearer auth). Usage: `creditsConsumed` and `costTime` (ms).

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

API keys are always explicit arguments; the package never reads environment variables and must not be imported into browser code. There is no provider, model or storage fallback, and reference images over a model's limit are rejected, never dropped.

Install the pinned GitHub Release asset (`kie-vX.Y.Z`). The full guide covers options, errors, usage/billing, pi-ai integration and Google AI Studio setup: https://github.com/kpkonghk01/pi-ai-extra#readme
