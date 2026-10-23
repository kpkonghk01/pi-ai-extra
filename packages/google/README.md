# @hk01/pi-ai-extra-google

Server-only extension to `@earendil-works/pi-ai`: Gemini chat (a chat provider with a live model list) and image generation. Image models: Gemini Nano Banana 2.1 (`gemini-nano-banana-2.1`), Gemini 3.1 Flash Image (`gemini-3.1-flash-image`) and Gemini 3 Pro Image (`gemini-3-pro-image`) through `generateContent`.

- Main entry (CommonJS and ESM): `generateGoogleImage()`, `GOOGLE_IMAGE_MODELS`, `PiAiExtraError` / `isPiAiExtraError`.
- `/pi-ai` subpath (ESM only, needs `@earendil-works/pi-ai@1.2.0`): `createGoogleProvider()`, one chat provider (a pi-ai `Provider` with the chat kit's `chatKit` traits and a live model list) serving Gemini chat and `GOOGLE_IMAGE_MODELS` (image settings in `imageSettings`).

pi-ai 1.2.0 has no Gemini image models; this package adds them. `createGoogleProvider()` serves pi-ai's own Gemini chat adapter and catalogue with the explicit key only; it never reads `GEMINI_API_KEY`. `GEMINI_CHAT_RATES` is Google's dated text-model rate schedule (3.8, 3.7 and 3.6 Flash double on 2027-01-01), and `googleChatRate(id)` looks a model's rate up, taking pi-ai's list price for an id outside the table. Optional `temperature` (0–2) and `systemInstruction` map to Gemini `generationConfig.temperature` and `systemInstruction`; omitted values are not sent. Usage: `usageMetadata` token counts. Safety blocks are `content_blocked`; a response without an image is `no_output`.

```ts
import { generateGoogleImage } from "@hk01/pi-ai-extra-google";

const result = await generateGoogleImage({
  apiKey: process.env.GEMINI_API_KEY!, // server-side secret, passed explicitly
  model: "gemini-3-pro-image",
  prompt: "Combine image 1 (template) with image 2 (photo)",
  referenceImages: [templateDataUrl, photoDataUrl],
  aspectRatio: "16:9",
  resolution: "2K",
  temperature: 0.7, // optional, 0–2 (generationConfig.temperature)
  systemInstruction: "Keep the template layout.", // optional Gemini system instruction
  headers: { "User-Agent": "aistudio-build" },
});
const { dataUrl } = result.images[0]!;
```

API keys are always explicit arguments; the package never reads a key or setting of its own from environment variables (the SDKs underneath read a few; the [root README](https://github.com/kpkonghk01/pi-ai-extra#chat-providers-and-createchatkit) lists them) and must not be imported into browser code. There is no provider, model or storage fallback, and reference images over a model's limit are rejected, never dropped.

Install the pinned GitHub Release asset (`google-vX.Y.Z`). The full guide covers options, errors, usage/billing, pi-ai integration and Google AI Studio setup: https://github.com/kpkonghk01/pi-ai-extra#readme
