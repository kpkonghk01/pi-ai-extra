# og-master migration, Part 1 of 4: server

You are editing this Google AI Studio app, 「Remix: OG 拼貼大師」: a React + Vite client (`App.tsx`, `components/`, `services/`) and an Express `server.ts`.

Today the two image routes, `/api/generate-collage` and `/api/edit-image`, call Gemini directly through `@google/genai`. When the chosen model fails, they silently try another model. Move both routes to the published provider packages, used through the image kit package (`@hk01/pi-ai-extra-image-kit`). Users can then pick any of 11 image models grouped by provider (Google Gemini, ToAPIs, KIE), and every request uses exactly the model they picked.

This task has four parts. Do them in order, one at a time:

- **Part 1 (this message):** server and package setup.
- **Part 2:** model selection in the UI (selector, limits, temperature, cost).
- **Part 3:** image requests, cancelling and error display in the UI.
- **Part 4:** small fixes (template presets, download file types, outdated text, AI logo mask).

The app cannot generate images again until Parts 1–3 are done. Do not test image generation before that.

## How to read the edits

- **Create** gives the full content of a new file. Copy it exactly.
- **Find** … **Replace with** shows an exact piece of the current code and what it becomes. Find the piece, then replace exactly that piece and nothing else.
- **Replace from** … **through** … **Replace with** means: find the first piece, find the first occurrence of the second piece after it, and replace everything from the start of the first piece to the end of the second piece (both included) with the new code.
- If a piece does not match the current code exactly, find the code that does the same thing, apply the same change to it, and tell me in your final report. Never skip a step.

## Rules for all four parts

1. **No fallback and no retry.** Each request uses exactly one provider and one model: the one the user selected. Do not add any retry, alternative model or alternative provider. Never re-send a request that may already have been billed.
2. **Never drop reference images.** The templates and source images are sent as they are. A model that cannot take them is disabled in the UI and rejected by the server.
3. **API keys stay on the server.** `GEMINI_API_KEY`, `KIE_API_KEY` and `TOAPIS_API_KEY` are read on the server only. Import `@hk01/pi-ai-extra-image-kit/server` only from `server.ts` and `server/`. Browser code uses only the package root, `/browser` and `/react`, and never reads `process.env`.
4. **Keep everything else as it is.** Keep every prompt text and system instruction exactly as it is. Firebase login, the gallery, presets, manga styles, titles, layout and styling stay unchanged except where a step says otherwise.
5. **Use the packages only through their exports.** Do not copy, patch or re-implement their code. If something in them seems wrong, stop and report it.

## Step 1: check that the build is ESM

Open `package.json`. The `build` script must end with `--format=esm --packages=external --sourcemap --outfile=dist/server.mjs`, and `start` must be `node dist/server.mjs`. The user changes these two lines by hand before this task.

If `build` still says `--format=cjs` or `dist/server.cjs`, **stop here** and tell the user to finish "步驟 0" in the migration guide first. Do not change the scripts yourself.

## Step 2: dependencies

**Find** in `package.json`:

```json
    "@google/genai": "^1.31.0",
```

**Replace with:**

```json
    "@google/genai": "^1.31.0",
    "@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.2/hk01-pi-ai-extra-google-0.3.2.tgz",
    "@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz",
    "@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.2.0/hk01-pi-ai-extra-kie-0.2.0.tgz",
    "@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.2.0/hk01-pi-ai-extra-toapis-0.2.0.tgz",
```

Use these exact URLs. Do not change their versions. Change nothing else in `package.json`: keep every other dependency and devDependency (including `tsx`, which the `dev` script needs). Then run `npm install`.

All three provider packages are needed even though the app used only Google before: the image kit loads all three, and the selector offers their models.

## Step 3: create `shared/imageOutput.ts`

The output size of each ratio and the resolution to generate it at: 1K for 16:9, 1:1 and the ad sizes, 2K for 4:5 and 9:16 (the same as the 1K / 2K labels in the ratio list). Before, the server always requested 2K.

**Create** `shared/imageOutput.ts`:

```ts
import type { AspectRatio } from '../types';

/**
 * Final output size for each ratio preset, and the generation resolution that covers it.
 * Shared by the server (what to request) and the browser (cost estimates).
 */
export type OutputResolution = '1K' | '2K';

export interface OutputSpec {
  width: number;
  height: number;
  resolution: OutputResolution;
}

export const OUTPUT_SPECS: Record<AspectRatio, OutputSpec> = {
  '16:9': { width: 1200, height: 675, resolution: '1K' },
  '4:5': { width: 1600, height: 2000, resolution: '2K' },
  '9:16': { width: 1080, height: 1920, resolution: '2K' },
  '1:1': { width: 1080, height: 1080, resolution: '1K' },
  '300x250': { width: 300, height: 250, resolution: '1K' },
  '300x300': { width: 300, height: 300, resolution: '1K' },
};

const FALLBACK_SPEC: OutputSpec = { width: 1024, height: 1024, resolution: '1K' };

export function outputSpec(ratio: string): OutputSpec {
  return OUTPUT_SPECS[ratio as AspectRatio] ?? FALLBACK_SPEC;
}
```

## Step 4: create `server/imageModels.ts`

The app's model policy. Every image model the installed packages provide is offered; this file only sets the app's labels, descriptions, verified prices and mask-editing hints. It creates one image client per route ("scope"): `collage` for `/api/generate-collage` and `edit` for `/api/edit-image`.

**Create** `server/imageModels.ts`:

```ts
import { createImageClient, type CataloguePolicy } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * og-master's catalogue policy and route-owned image clients. Every image model family in the
 * installed Google, ToAPIs and KIE packages is offered, so a provider package upgrade adds its new
 * families. Limits and capabilities come from the catalogues; this file only holds the app's own
 * labels, verified prices and mask-editing guidance (the same as Auto OG's).
 */

const POLICY: CataloguePolicy = {
  overrides: {
    'google:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1',
      description: 'Google 直連 Gemini Nano Banana 2.1，最新旗艦高效率生圖模型。',
      maskEditing: 'supported',
      price: { perImageUsd: { '1K': 0.034, '2K': 0.05 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3.1-flash-image': {
      label: 'Nano Banana 2（2代平衡）',
      description: 'Google 直連 Gemini 3.1 Flash Image，速度快，適合一般拼貼。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $0.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.067, '2K': 0.101 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3-pro-image': {
      label: 'Nano Banana Pro（Pro 思考）',
      description: 'Google 直連 Gemini 3 Pro Image，細節更豐富，適合高要求圖片。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $2.00 / 1M tokens.
      price: { perImageUsd: { '1K': 0.134, '2K': 0.134 }, inputPerMillionTokensUsd: 2 },
    },
    'toapis:gemini-3.1-flash-image-preview': {
      label: 'Nano Banana 2 Preview (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
      maskEditing: 'supported',
    },
    'toapis:gpt-image-2': { label: 'GPT Image 2 (ToAPIs)', description: 'ToAPIs 提供的 GPT Image 2。' },
    'toapis:gpt-image-2.5-flare': {
      label: 'GPT Image 2.5 Flare (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Flare。',
      // ToAPIs GPT Image 2.5 doc (2026-09-09).
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2.5-sunburst': {
      label: 'GPT Image 2.5 Sunburst (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。',
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:doubao-seedream-5-0-pro': { label: 'Seedream 5.0 Pro (ToAPIs)', description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。' },
    'kie:grok-imagine-image-2-0': { label: 'Grok Imagine 2.0 (KIE)', description: 'KIE 提供的 Grok Imagine 2.0。' },
    'kie:gpt-image-2': { label: 'GPT Image 2 (KIE)', description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。' },
    'kie:nano-banana-2': { label: 'Nano Banana 2 (KIE)', description: 'KIE 提供的 Gemini 3.1 Flash Image。', maskEditing: 'supported' },
  },
  scopes: {
    collage: {},
    edit: {},
  },
};

export const imageClient = createImageClient({
  app: 'og-master',
  policy: POLICY,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const collageImages = imageClient.forScope('collage');
export const editImages = imageClient.forScope('edit');
```

## Step 5: `server.ts`

Replace the `@google/genai` import. The server no longer calls Gemini directly.

**Find** in `server.ts`:

```ts
import { GoogleGenAI } from "@google/genai";
```

**Replace with:**

```ts
import {
  handleImageRequest,
  imageErrorBody,
  imageErrorStatus,
  type ImagePart,
} from "@hk01/pi-ai-extra-image-kit/server";
import { collageImages, editImages, imageClient } from "./server/imageModels";
import { OUTPUT_SPECS, outputSpec } from "./shared/imageOutput";
```

Replace the old helpers (`urlToAsset`, `mapRatioToSupported`, `mapQualityToSize`, `buildImageConfig`) with two new ones. `urlToAsset` downloaded any http(s) URL it was given; the browser always sends data URLs, so the server now refuses anything else.

**Replace from** `server.ts`:

```ts
// Helper to resolve third-party URLs to Base64 in Node.js
```

**through:**

```ts
  return config;
};
```

**Replace with:**

```ts
/** A base64 data URL as an image part, or null for anything else (other URLs are never fetched). */
const inlineImage = (dataUrl: unknown): ImagePart | null => {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl.trim());
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
};

/** Errors found before streaming starts go back as JSON; validation errors keep their HTTP status. */
const sendImageError = (res: express.Response, route: string, error: unknown) => {
  console.error(`[PROXY ERROR] ${route} failed:`, error);
  if (res.headersSent) return;
  res.status(imageErrorStatus(error)).json(imageErrorBody(error));
};
```

Add the model list endpoint before the collage route.

**Find** in `server.ts`:

```ts
// API: Process Collage Generation via Tokyo Cloud Run server proxy
```

**Replace with:**

```ts
// API: Image models for one route-owned scope (?scope=collage | edit)
app.get("/api/image-models", (req, res) => {
  const scope = typeof req.query.scope === "string" ? req.query.scope : "";
  try {
    res.json({ models: imageClient.forScope(scope).listModels() });
  } catch (error) {
    res.status(400).json(imageErrorBody(error));
  }
});

// API: Process Collage Generation via Tokyo Cloud Run server proxy
```

### `/api/generate-collage`

Remove the Gemini key check: the image kit checks the selected provider's key itself and answers HTTP 503 when it is missing.

**Find** in `server.ts`:

```ts
app.post("/api/generate-collage", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: "Missing backend Gemini API Key" });
    }
```

**Replace with:**

```ts
app.post("/api/generate-collage", async (req, res) => {
  try {
```

Remove the Gemini client and check the ratio. The parts are now image-kit `ImagePart`s; the template and source parts below them stay exactly as they are.

**Find** in `server.ts`:

```ts
      prohibitPretrainedData = true
    } = req.body;

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
    const parts: any[] = [];

    if (templateAssets && templateAssets.length > 0) {
```

**Replace with:**

```ts
      prohibitPretrainedData = true
    } = req.body;

    if (!(String(ratio) in OUTPUT_SPECS)) {
      return res.status(400).json({ error: `不支援的圖片比例「${ratio}」。`, details: { code: "invalid_request" } });
    }

    const parts: ImagePart[] = [];

    if (templateAssets && templateAssets.length > 0) {
```

Replace the model list, the model-by-model loop and the JSON response with one call to the selected model. Keep every prompt and system instruction above this point unchanged.

**Replace from** `server.ts`:

```ts
    parts.push({ text: finalPrompt });
```

**through:**

```ts
    console.error("[PROXY ERROR] generate-collage failed:", error);
    return res.status(500).json({ error: error?.message || error?.toString() });
  }
```

**Replace with:**

```ts
    parts.push({ text: finalPrompt });

    // One attempt with the selected provider/model: no fallback model and no retry.
    const appModelId = String(selectedModel ?? "");
    await handleImageRequest(
      res,
      collageImages,
      {
        appModelId,
        parts,
        systemInstruction,
        // The ratio preset ("16:9", "300x250", …): image-kit sends the model's exact ratio or the
        // nearest one, and the browser centre-crops the result to the exact output size.
        aspectRatio: String(ratio),
        resolution: outputSpec(String(ratio)).resolution,
        // Only models that accept temperature get the slider value (the UI disables it for the others).
        temperature: collageImages.findModel(appModelId)?.temperature ? temperature : undefined,
      },
      async (image) => ({ imageUrl: image.dataUrl }),
    );
  } catch (error) {
    sendImageError(res, "generate-collage", error);
  }
```

### `/api/edit-image`

**Find** in `server.ts`:

```ts
app.post("/api/edit-image", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: "Missing backend Gemini API Key" });
    }

    const {
      imageUrl,
      maskBase64,
      prompt,
      isMultiMask,
      selectedModel
    } = req.body;

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
    const parts: any[] = [];
```

**Replace with:**

```ts
app.post("/api/edit-image", async (req, res) => {
  try {
    const {
      imageUrl,
      maskBase64,
      prompt,
      isMultiMask,
      selectedModel,
      sourceAspect
    } = req.body;

    const parts: ImagePart[] = [];
```

Keep the `systemInstruction` text that follows unchanged. Then replace the base image part:

**Find** in `server.ts`:

```ts
    const imageAsset = await urlToAsset(imageUrl);
    parts.push({
      inlineData: {
        data: imageAsset.data,
        mimeType: imageAsset.mimeType,
      }
    });
```

**Replace with:**

```ts
    // Images arrive as data URLs from the browser; any other URL is refused, never fetched.
    const baseImage = inlineImage(imageUrl);
    const maskImage = maskBase64 ? inlineImage(maskBase64) : null;
    if (!baseImage || (maskBase64 && !maskImage)) {
      return res.status(400).json({ error: "圖片必須以 base64 data URL 傳送。", details: { code: "invalid_request" } });
    }
    parts.push(baseImage);
```

and the mask part (the mask was already checked above):

**Find** in `server.ts`:

```ts
      const maskAsset = await urlToAsset(maskBase64);
      parts.push({
        inlineData: {
          data: maskAsset.data,
          mimeType: maskAsset.mimeType
        }
      });
```

**Replace with:**

```ts
      parts.push(maskImage!);
```

Keep the multi-mask, single-mask and global-edit instruction texts after it unchanged. Then replace the model list, the loop and the JSON response:

**Replace from** `server.ts`:

```ts
    const models = (selectedModel === "gemini-nano-banana-2.1" || selectedModel === "nano-banana-2.1")
      ? ["gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-3-pro-image"]
      : (selectedModel === "nano-banana-2-lite"
```

**through:**

```ts
    console.error("[PROXY ERROR] edit-image failed:", error);
    return res.status(500).json({ error: error?.message || error?.toString() });
  }
```

**Replace with:**

```ts
    // One attempt with the selected provider/model: no fallback model and no retry.
    await handleImageRequest(
      res,
      editImages,
      {
        appModelId: String(selectedModel ?? ""),
        parts,
        systemInstruction,
        // The original image's "width:height": the nearest ratio is sent when the model cannot keep
        // the input aspect by itself, and the browser crops the result back to the original size.
        aspectRatio: typeof sourceAspect === "string" ? sourceAspect : undefined,
        keepInputAspect: true,
        // Edits have always requested 1K.
        resolution: "1K",
      },
      async (image) => ({ imageUrl: image.dataUrl }),
    );
  } catch (error) {
    sendImageError(res, "edit-image", error);
  }
```

What changed, so you can check the result:

- **New `GET /api/image-models?scope=collage|edit`.** It returns the model list for the selector. Without a valid scope it answers HTTP 400.
- **Both image routes stream NDJSON:** a `start` line, a `ping` every 10 seconds, then `complete` (with `imageUrl`) or `error` (with `error` and `details`: provider, model, code, HTTP status, task id).
- **Invalid requests are rejected before any provider is called**, with JSON and HTTP 400 or 503. Examples: an unknown model, a missing key, too many reference images, an unknown ratio, or a prompt that is too long.
- **Removed:** the model-by-model fallback loops in both routes, the Gemini key check, and the server-side download of image URLs.
- **The image order is unchanged:** templates, then sources, then the instructions for collages; base image, then mask, then the instructions for edits. Images are now sent as one prompt with `[Reference image N]` markers plus the images in order, as in the other migrated apps.

## Step 6: `vite.config.ts`

Remove the `define` that copies `GEMINI_API_KEY` into the browser bundle. API keys must stay on the server.

**Find** in `vite.config.ts`:

```ts
import { defineConfig, loadEnv } from 'vite';
```

**Replace with:**

```ts
import { defineConfig } from 'vite';
```

**Find** in `vite.config.ts`:

```ts
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
```

**Replace with:**

```ts
// No `define` for API keys: keys stay on the server and never enter the browser bundle.
export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
```

## Step 7: `.env.example`

**Find** in `.env.example`:

```text
GEMINI_API_KEY=
```

**Replace with:**

```text
GEMINI_API_KEY=

# KIE_API_KEY: Required for the KIE image models (Nano Banana 2, GPT Image 2, Grok Imagine 2.0)
KIE_API_KEY=

# TOAPIS_API_KEY: Required for the ToAPIs image models (GPT Image 2 / 2.5, Seedream 5.0 Pro, Nano Banana 2 Preview)
TOAPIS_API_KEY=
```

## Step 8: check Part 1

1. `npm run lint` passes.
2. `server.ts` no longer contains `GoogleGenAI`, `urlToAsset`, `buildImageConfig`, `mapRatioToSupported`, `const models =` or `rawImageBase64`.
3. `vite.config.ts` no longer contains `define` or `GEMINI_API_KEY`.
4. Reply with every file you created or changed, and every step where the code did not match exactly and how you applied it.

Do not start Part 2 until the user sends it.
