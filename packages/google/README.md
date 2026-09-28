# @hk01/pi-ai-extra-google

Server-only extension to `@earendil-works/pi-ai`: Gemini 3.1 Flash Image (`gemini-3.1-flash-image`) and Gemini 3 Pro Image (`gemini-3-pro-image`) through `generateContent`.

- Main entry (CommonJS and ESM): `generateGoogleImage()`, `GOOGLE_IMAGE_MODELS`, `PiAiExtraError` / `isPiAiExtraError`.
- `/pi-ai` subpath (ESM only, needs `@earendil-works/pi-ai@0.87.1`): `createGoogleProvider()` (pi-ai `Models`, Gemini chat) and `createGoogleImagesProvider()` (pi-ai `ImagesModels`).

pi-ai 0.87.1 has no Gemini image output; this package adds it. `createGoogleProvider()` serves pi-ai's own Gemini chat adapter and catalogue (Google list prices included) with the explicit key only; it never reads `GEMINI_API_KEY`. Usage: `usageMetadata` token counts. Safety blocks are `content_blocked`; a response without an image is `no_output`.

```ts
import { generateGoogleImage } from "@hk01/pi-ai-extra-google";

const result = await generateGoogleImage({
  apiKey: process.env.GEMINI_API_KEY!, // server-side secret, passed explicitly
  model: "gemini-3-pro-image",
  prompt: "Combine image 1 (template) with image 2 (photo)",
  referenceImages: [templateDataUrl, photoDataUrl],
  aspectRatio: "16:9",
  resolution: "2K",
  headers: { "User-Agent": "aistudio-build" },
});
const { dataUrl } = result.images[0]!;
```

API keys are always explicit arguments; the package never reads environment variables and must not be imported into browser code. There is no provider, model or storage fallback, and reference images over a model's limit are rejected, never dropped.

Install the pinned GitHub Release asset (`google-vX.Y.Z`). The full guide covers options, errors, usage/billing, pi-ai integration and Google AI Studio setup: https://github.com/kpkonghk01/pi-ai-extra#readme
