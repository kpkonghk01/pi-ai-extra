# opengraph2 migration, Part 1 of 3: server

You are editing this Google AI Studio app, 「Open Graph2 圖片製作大師」: a React + Vite client (almost all of it in `src/App.tsx`) and an Express `server.ts`.

Today every model call goes straight to Gemini through `@google/genai`. Move the two **image** routes, `/api/generate-og-image` and `/api/deep-edit`, to the published provider packages, used through the image kit package (`@hk01/pi-ai-extra-image-kit`). Users can then pick any of 11 image models grouped by provider (Google Gemini, ToAPIs, KIE). The text analysis route `/api/analyze-og` keeps using `@google/genai`.

This task has three parts. Do them in order, one at a time:

- **Part 1 (this message):** server and package setup.
- **Part 2:** model list, model selector, limits and labels in the UI.
- **Part 3:** image requests, cancelling and error display in the UI.

The app cannot generate images again until all three parts are done. Do not test image generation before that.

## How to read the edits

- **Create** gives the full content of a new file. Copy it exactly.
- **Replace the whole file** gives the full new content of an existing file. Replace everything in it.
- **Find** … **Replace with** shows an exact piece of the current code and what it becomes. Find the piece, then replace exactly that piece and nothing else.
- If a piece does not match the current code exactly, find the code that does the same thing, apply the same change to it, and tell me in your final report. Never skip a step.

## Rules for all three parts

1. **No fallback and no retry.** Each request uses exactly one provider and one model: the one the user selected. Do not add any retry, alternative model or alternative provider. Never re-send a request that may already have been billed.
2. **Never drop reference images.** The template, source images and logo are sent as they are. A model that cannot take them is disabled in the UI and rejected by the server.
3. **API keys stay on the server.** `GEMINI_API_KEY`, `KIE_API_KEY` and `TOAPIS_API_KEY` are read on the server only. Import `@hk01/pi-ai-extra-image-kit/server` only from `server.ts` and `server/`. Browser code uses only the package root, `/browser` and `/react`. Browser code must not read `process.env`.
4. **Keep everything else as it is.** Keep every prompt text exactly as it is. Firebase, Firestore rules, history, logo tools, manga styles, layout and styling stay unchanged.
5. **Use the packages only through their exports.** Do not copy, patch or re-implement their code. If something in them seems wrong, stop and report it.

## Step 1: check that the build is ESM

Open `package.json`. The `build` script must end with `--format=esm --packages=external --sourcemap --outfile=dist/server.mjs`, and `start` must be `node dist/server.mjs`. The user changes these two lines by hand before this task.

If `build` still says `--format=cjs` or `dist/server.cjs`, **stop here** and tell the user to finish "步驟 0" in the migration guide first. Do not change the scripts yourself.

## Step 2: dependencies

**Find** in `package.json`:

```json
    "@google/genai": "^1.29.0",
```

**Replace with:**

```json
    "@google/genai": "^1.29.0",
    "@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.2/hk01-pi-ai-extra-google-0.3.2.tgz",
    "@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz",
    "@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.2.0/hk01-pi-ai-extra-kie-0.2.0.tgz",
    "@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.2.0/hk01-pi-ai-extra-toapis-0.2.0.tgz",
```

Use these exact URLs. Do not change their versions and do not remove `@google/genai`: the text analysis still uses it. Change nothing else in `package.json`. Then run `npm install`.

All three provider packages are needed even though the app used only Google before: the image kit loads all three, and the selector offers their models.

## Step 3: create `server/imageModels.ts`

This file is the app's model policy. Every image model the installed packages provide is offered. The file only sets the app's own labels, descriptions, verified prices and mask-editing hints. It also creates one image client per route ("scope"): `generate` for `/api/generate-og-image` and `edit` for `/api/deep-edit`.

**Create** `server/imageModels.ts`:

```ts
import { createImageClient, type CataloguePolicy } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * opengraph2's catalogue policy and route-owned image clients. Every image model family in the
 * installed Google, ToAPIs and KIE packages is offered, so a provider package upgrade adds its new
 * families. Limits and capabilities come from the catalogues; this file only holds the app's own
 * labels, verified prices and mask-editing guidance.
 */

const POLICY: CataloguePolicy = {
  overrides: {
    'google:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1',
      description: '最新旗艦圖片模型，預設推薦',
      maskEditing: 'supported',
      price: { perImageUsd: { '1K': 0.034, '2K': 0.05 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3.1-flash-image': {
      label: 'Nano Banana 2',
      description: '速度極快，適合快速迭代',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $0.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.067, '2K': 0.101 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3-pro-image': {
      label: 'Nano Banana Pro',
      description: '細節更強，適合複雜佈局',
      maskEditing: 'supported',
      // Google pricing page (2026-10-01), input $2.00 / 1M tokens.
      price: { perImageUsd: { '1K': 0.134, '2K': 0.134 }, inputPerMillionTokensUsd: 2 },
    },
    'toapis:gpt-image-2.5-flare': {
      label: 'GPT Image 2.5 Flare (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Flare。',
      maskEditing: 'reference-only',
      // ToAPIs GPT Image 2.5 doc (2026-09-09).
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2.5-sunburst': {
      label: 'GPT Image 2.5 Sunburst (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。',
      maskEditing: 'reference-only',
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2': {
      label: 'GPT Image 2 (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2。',
      maskEditing: 'reference-only',
    },
    'toapis:doubao-seedream-5-0-pro': {
      label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
      description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。',
      maskEditing: 'reference-only',
    },
    'toapis:gemini-3.1-flash-image-preview': {
      label: 'Nano Banana 2 Preview (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
      maskEditing: 'supported',
    },
    'kie:grok-imagine-image-2-0': {
      label: 'Grok Imagine 2.0 (KIE)',
      description: 'KIE 提供的 Grok Imagine 2.0。',
      maskEditing: 'reference-only',
    },
    'kie:gpt-image-2': {
      label: 'GPT Image 2 (KIE)',
      description: 'KIE 提供的 GPT Image 2。',
      maskEditing: 'reference-only',
    },
    'kie:nano-banana-2': {
      label: 'Nano Banana 2 (KIE)',
      description: 'KIE 提供的 Nano Banana 2。',
      maskEditing: 'supported',
    },
  },
  scopes: {
    generate: {},
    edit: {},
  },
};

export const imageClient = createImageClient({
  app: 'opengraph2',
  policy: POLICY,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const generateImages = imageClient.forScope('generate');
export const editImages = imageClient.forScope('edit');
```

## Step 4: replace `server.ts`

**Replace the whole file** `server.ts`:

```ts
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import {
  handleImageRequest,
  imageErrorBody,
  imageErrorStatus,
  type ImagePart,
} from "@hk01/pi-ai-extra-image-kit/server";
import { editImages, generateImages, imageClient } from "./server/imageModels";

dotenv.config();

/** A base64 data URL as an inline image part, keeping its real type (deep-edit results are PNG). */
function inlineImage(dataUrl: string): ImagePart {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
  // Bare base64 without a data URL header.
  return { inlineData: { mimeType: "image/jpeg", data: dataUrl } };
}

/** Errors found before streaming starts go back as JSON; validation errors keep their HTTP status. */
function sendImageError(res: express.Response, route: string, error: unknown) {
  console.error(`API ${route} error:`, error);
  if (res.headersSent) return;
  res.status(imageErrorStatus(error)).json(imageErrorBody(error));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Helper to initialize Gemini SDK (text analysis only; images go through image-kit)
  const getAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY 未於伺服器環境變數中設定。請在設定中確認金鑰。");
    }
    return new GoogleGenAI({ apiKey });
  };

  // Image models for one route-owned scope (?scope=generate | edit)
  app.get("/api/image-models", (req, res) => {
    const scope = typeof req.query.scope === "string" ? req.query.scope : "";
    try {
      res.json({ models: imageClient.forScope(scope).listModels() });
    } catch (error) {
      res.status(400).json(imageErrorBody(error));
    }
  });

  // 1. Analyze OG Prompt Endpoint
  app.post("/api/analyze-og", async (req, res) => {
    try {
      const {
        promptText,
        activeTemplate,
        sourceImages = [],
        brandLogo,
        reasoningModel = "gemini-3.8-flash"
      } = req.body;
      const ai = getAI();

      const parts: ImagePart[] = [
        { text: promptText }
      ];

      if (activeTemplate) {
        parts.push({ text: "【最高基準：樣板圖片 (Design, Typography & Aesthetic Style Template)】：\n這是排版佈局、主標題字體風格、文字色彩與整體美術調性的最高基準。請深入分析其字體外觀（字重粗細、文字顏色、是否有描邊綑邊、是否有底襯）與設計風格。" });
        parts.push(inlineImage(activeTemplate));
      }

      sourceImages.forEach((img: string, i: number) => {
        parts.push({ text: `【素材圖片第 ${i + 1} 張 (Source Image - 人物/主體內容)】:` });
        parts.push(inlineImage(img));
      });

      if (brandLogo) {
        parts.push({ text: "【用戶提供的新 Logo (優先使用於樣板指定位置)】:" });
        parts.push(inlineImage(brandLogo));
      }

      // One attempt with the requested model: no retry, no fallback model.
      const analyzerResult = await ai.models.generateContent({
        model: reasoningModel || "gemini-3.8-flash",
        contents: [{ parts }],
      });

      res.json({ refinedPrompt: analyzerResult.text });
    } catch (error: any) {
      console.error("API /api/analyze-og error:", error);
      const errMsg = error?.message || String(error);
      if (errMsg.includes("User location is not supported")) {
        return res.status(400).json({
          error: "地區連線限制 (User location is not supported)。請確認伺服器環境部署位置或稍後重試。",
        });
      }
      res.status(500).json({ error: errMsg });
    }
  });

  // 2. Generate OG Image Endpoint (scope "generate")
  app.post("/api/generate-og-image", async (req, res) => {
    try {
      const {
        model,
        generatorPrompt,
        activeTemplate,
        sourceImages = [],
        brandLogo,
        temperature,
        ratio,
      } = req.body;
      const appModelId = String(model ?? "");

      const parts: ImagePart[] = [
        { text: generatorPrompt }
      ];

      if (activeTemplate) {
        parts.push({ text: "【樣板圖片 (Design, Typography & Style Blueprint)】：\n這是排版與標題字體外觀基準。請參考此圖的文字色彩與排版位置。若生成指令要求零描邊純平字體，標題文字必須呈現為純平向量實心色塊（Flat solid vector fill typography, borderless），描邊寬度強制為 0 像素。" });
        parts.push(inlineImage(activeTemplate));
      }

      sourceImages.forEach((img: string, i: number) => {
        parts.push({ text: `【素材圖片第 ${i + 1} 張 (Source Image - 提取主體人物/產品內容)】:` });
        parts.push(inlineImage(img));
      });

      if (brandLogo) {
        parts.push({ text: "【用戶指定品牌 Logo (精準置於樣板指定位置)】:" });
        parts.push(inlineImage(brandLogo));
      }

      await handleImageRequest(
        res,
        generateImages,
        {
          appModelId,
          parts,
          // The UI ratio id ("16:9", "300x250", …). image-kit sends the model's exact ratio or the
          // nearest one; the browser crops the result to the exact output size.
          aspectRatio: String(ratio ?? ""),
          resolution: "1K",
          // Only models that accept temperature get the slider value (the UI disables it otherwise).
          temperature: generateImages.findModel(appModelId)?.temperature ? temperature : undefined,
        },
        async (image) => ({ imageUrl: image.dataUrl }),
      );
    } catch (error) {
      sendImageError(res, "/api/generate-og-image", error);
    }
  });

  // 3. Deep Edit Endpoint (scope "edit"; also used by AI logo erase)
  app.post("/api/deep-edit", async (req, res) => {
    try {
      const { base64Data, promptText, model, aspectRatio } = req.body;
      const appModelId = String(model ?? "");

      await handleImageRequest(
        res,
        editImages,
        {
          appModelId,
          parts: [inlineImage(String(base64Data ?? "")), { text: promptText }],
          // The canvas "width:height"; used when the model cannot keep the input aspect by itself.
          aspectRatio: typeof aspectRatio === "string" ? aspectRatio : undefined,
          keepInputAspect: true,
          resolution: "1K",
        },
        async (image) => ({ imageUrl: image.dataUrl }),
      );
    } catch (error) {
      sendImageError(res, "/api/deep-edit", error);
    }
  });

  // Vite middleware for dev or static serving for prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
```

What changed, so you can check the result:

- **New `GET /api/image-models?scope=generate|edit`.** It returns the model list for the selector. Without a valid scope it answers HTTP 400.
- **`/api/generate-og-image`** builds the same prompt parts as before, with the same labels in the same order. It then calls `handleImageRequest()` with the selected model:
  - The request field `apiRatio` is replaced by `ratio`, the UI ratio id (`"16:9"`, `"300x250"`, …). The image kit picks the model's own ratio or the nearest one.
  - Temperature is sent only to models that accept it.
- **`/api/deep-edit`** sends the image and the instruction through `handleImageRequest()`. It uses the new request field `aspectRatio` (the canvas `width:height`) and keeps the input image's aspect where the model can.
- **Both image routes stream NDJSON:** a `start` line, a `ping` every 10 seconds, then `complete` (with `imageUrl`) or `error` (with `error` and `details`). Invalid requests are answered with JSON and HTTP 400 or 503 before any provider is called. Examples: an unknown model, a missing key, too many reference images, or a prompt that is too long.
- **Removed:** `callWithRetry`, which retried every error up to 3 times and billed each attempt. Also removed are both silent fallbacks from Nano Banana 2.1 to `gemini-3.1-flash-image`, and the analysis fallback model.
- **Reference images keep their real type** (`inlineImage()`). Before, every image was labelled `image/jpeg`, including PNG images from the deep editor.
- `/api/analyze-og` is unchanged except for the points above: no retry and no fallback, one call with `gemini-3.8-flash`.

## Step 5: `vite.config.ts`

Remove the `define` that copies `GEMINI_API_KEY` into the browser bundle. No browser code reads it, and API keys must stay on the server.

**Find** in `vite.config.ts`:

```ts
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
```

**Replace with:**

```ts
import {defineConfig} from 'vite';

// No `define` for GEMINI_API_KEY: API keys stay on the server and never enter the browser bundle.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
```

## Step 6: `.env.example`

Document the two new secrets.

**Find** in `.env.example`:

```
GEMINI_API_KEY="MY_GEMINI_API_KEY"
```

**Replace with:**

```
GEMINI_API_KEY="MY_GEMINI_API_KEY"

# KIE_API_KEY: Required for the KIE image models (Nano Banana 2, GPT Image 2, Grok Imagine 2.0).
KIE_API_KEY="MY_KIE_API_KEY"

# TOAPIS_API_KEY: Required for the ToAPIs image models (GPT Image 2 / 2.5, Seedream 5.0 Pro, Nano Banana 2 Preview).
TOAPIS_API_KEY="MY_TOAPIS_API_KEY"
```

## Step 7: check Part 1

1. `npm run lint` passes.
2. `server.ts` no longer contains `callWithRetry`, `generateWithModel`, `editWithModel` or `apiRatio`.
3. `vite.config.ts` no longer contains `define` or `GEMINI_API_KEY`.
4. Reply with every file you created or changed, and every step where the code did not match exactly and how you applied it.

Do not start Part 2 until the user sends it.
