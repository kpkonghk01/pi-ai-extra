# @hk01/pi-ai-extra-toapis

Server-only extension to `@earendil-works/pi-ai`: Gemini 3.1 Flash Image (`gemini-3.1-flash-image-preview`), GPT Image 2 (`gpt-image-2`), GPT Image 2.5 (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`) and Seedream 5.0 Pro (`doubao-seedream-5-0-pro`).

- Main entry (CommonJS and ESM): `generateToapisImage()`, `getToapisTask()`, `TOAPIS_IMAGE_MODELS`, `PiAiExtraError` / `isPiAiExtraError`.
- `/pi-ai` subpath (ESM only, needs `@earendil-works/pi-ai@0.87.1`): `createToapisProvider()` (pi-ai `Models`) and `createToapisImagesProvider()` (pi-ai `ImagesModels`).

Chat: Codex on OpenAI Responses (`https://toapis.com/v1`) and Claude on Anthropic Messages (`https://toapis.com`). Usage: `billing` (status, decimal-string credits/cost) and token `usage`; billing can be `pending` at completion, so re-read with `getToapisTask` and record one value per task id. `clientBusinessId` is sent as `client_business_id`.

```ts
import { generateToapisImage } from "@hk01/pi-ai-extra-toapis";

const result = await generateToapisImage({
  apiKey: process.env.TOAPIS_API_KEY!, // server-side secret, passed explicitly
  model: "gpt-image-2.5-flare",
  prompt: "An Open Graph cover for a technology story",
  aspectRatio: "16:9",
  resolution: "2K",
  clientBusinessId: "open-graph-single:req-123",
});
const { dataUrl } = result.images[0]!;
```

API keys are always explicit arguments; the package never reads environment variables and must not be imported into browser code. There is no provider, model or storage fallback, and reference images over a model's limit are rejected, never dropped.

Install the pinned GitHub Release asset (`toapis-vX.Y.Z`). The full guide covers options, errors, usage/billing, pi-ai integration and Google AI Studio setup: https://github.com/kpkonghk01/pi-ai-extra#readme
