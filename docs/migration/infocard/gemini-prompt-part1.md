# InfoCard migration, Part 1 of 3: server

You are editing this Google AI Studio app: a React + Vite client and an Express `server.ts`, built as ESM to `dist/server.mjs`. It has four tools (OG 拼貼, InfoCard 圖卡, OG 奪舍, 批量修圖) and an image editor (DeepEditor).

Image generation currently calls Gemini directly through `@google/genai`, ToAPIs through `server/providers/toapis.ts` and OpenRouter through `server/providers/openrouter.ts`. Move all five image routes to the published provider packages, used through the image kit package (`@hk01/pi-ai-extra-image-kit`), so that users can pick any of ten image models grouped by provider (Google Gemini, ToAPIs, KIE).

## Rules for all three parts

1. **No fallback of any kind.** Each request uses exactly one provider and one model: the one the user selected.
   - Delete the ToAPIs and OpenRouter branches in the image routes, and the ToAPIs "safety review" retry with a simplified prompt.
   - Do not add any retry, alternative model or alternative provider. Never re-send a request that may already have been billed.
2. **Never drop reference images.** Reference images are never sliced, filtered or dropped to fit a model (delete the `.slice(0, 5)` in the batch route). A model that cannot take them is disabled in the UI and rejected by the server.
3. **API keys stay on the server.**
   - `GEMINI_API_KEY`, `KIE_API_KEY` and `TOAPIS_API_KEY` (or the older `TOAPI_API_KEY`) are read on the server only, by `@hk01/pi-ai-extra-image-kit/server`.
   - Import `@hk01/pi-ai-extra-image-kit/server` only from server code (`server.ts`, `server/`). Browser code uses the package root, `/browser` and `/react`.
   - Remove the Vite `define` that copies the Gemini key into the browser bundle. Browser code must not read `process.env`.
4. **Every failure reaches the UI completely.** The error panel from `@hk01/pi-ai-extra-image-kit/react` shows the provider, the model, the error code, the HTTP status, the task id and the message, and has a 「複製錯誤資訊」 button. Do not replace errors with generic text.
5. **Keep everything else as it is.**
   - Keep every prompt text exactly as it is, except the edits shown here.
   - Do not touch the text routes `/api/infocard/analyze-article`, `/api/possession/extract-material` and `/api/batch-edit/prompt-magic`, or their `@google/genai` usage.
   - Firebase, Firestore rules, history, layout and styling stay unchanged.
6. **Do not change the `build` or `start` scripts.** The server is built as ESM to `dist/server.mjs`.
7. **Use the four packages only through their exports.** Do not copy, patch or re-implement their code. If something in them seems wrong, stop and report it.
8. **Copy new files exactly as given, and do not invent package APIs.** Where a diff below does not match the current code exactly, apply its intent to the matching code. Do not skip it.

## Step 1: dependencies

Add these four entries to `dependencies` in `package.json`, and change nothing else in that file:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.2.0/hk01-pi-ai-extra-google-0.2.0.tgz",
"@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.1.0/hk01-pi-ai-extra-image-kit-0.1.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
```

The image kit has four entries: the package root (types and checks, safe everywhere), `/server` (server only), `/browser` (reads the streamed image responses, collects errors) and `/react` (model selector, hints, error panel).

## Step 2: create `server/imageModels.ts`

The ten image models, in selector order, and the image client every route uses. Create the file with exactly this content:

```ts
import sharp from 'sharp';
import { createImageClient, type ImageModelOption, type ReferenceConverter } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * The image models InfoCard offers, in selector order (grouped like open-graph-single), and the
 * shared image client every image route uses. Limits and capabilities come from the package
 * catalogues through @hk01/pi-ai-extra-image-kit; this file only holds InfoCard's own choices.
 */

export const DEFAULT_IMAGE_MODEL_ID = 'nano-banana-2';

const MODELS: readonly ImageModelOption[] = [
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    description: '預設模型，Google 直連 Gemini 3.1 Flash Image，生成速度快。',
    provider: 'google',
    model: 'gemini-3.1-flash-image',
    maskEditing: 'supported',
    // Google pricing page (2026-10-06): image output $60 / 1M tokens, input $0.50 / 1M tokens.
    price: { perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, inputPerMillionTokensUsd: 0.5 },
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    description: '進階模型，Google 直連 Gemini 3 Pro Image，細節更豐富。',
    provider: 'google',
    model: 'gemini-3-pro-image',
    maskEditing: 'supported',
    // Google pricing page (2026-10-06): image output $120 / 1M tokens, input $2.00 / 1M tokens.
    price: { perImageUsd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 }, inputPerMillionTokensUsd: 2 },
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Flare，支援參考圖輸入。',
    provider: 'toapis',
    model: 'gpt-image-2.5-flare',
    maskEditing: 'reference-only',
    // ToAPIs GPT Image 2.5 doc (verified 2026-09-09); reference images have no extra fee.
    price: { perImageUsd: { '1K': 0.015, '2K': 0.02, '4K': 0.025 }, inputPerMillionTokensUsd: 0 },
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst，支援參考圖輸入。',
    provider: 'toapis',
    model: 'gpt-image-2.5-sunburst',
    maskEditing: 'reference-only',
    price: { perImageUsd: { '1K': 0.015, '2K': 0.02, '4K': 0.025 }, inputPerMillionTokensUsd: 0 },
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2，高創意度與畫面品質。',
    provider: 'toapis',
    model: 'gpt-image-2',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'doubao-seedream-5-0-pro',
    label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
    description: 'ByteDance 豆包 Seedream 5.0 Pro，最高 2K；參考圖會轉為 PNG / JPEG 送出。',
    provider: 'toapis',
    model: 'doubao-seedream-5-0-pro',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 Preview (ToAPIs)',
    description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
    provider: 'toapis',
    model: 'gemini-3.1-flash-image-preview',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'kie-grok-imagine-2',
    label: 'Grok Imagine 2.0 (KIE)',
    description: 'KIE 提供的 xAI Grok Imagine 2.0；有參考圖時最多 5 張、prompt 上限 8,000 字元，沒有解像度選項。',
    provider: 'kie',
    model: 'grok-imagine-image-2-0/image-edit',
    textOnlyModel: 'grok-imagine-image-2-0/text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-gpt-image-2',
    label: 'GPT Image 2 (KIE)',
    description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。',
    provider: 'kie',
    model: 'gpt-image-2-image-to-image',
    textOnlyModel: 'gpt-image-2-text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-nano-banana-2',
    label: 'Nano Banana 2 (KIE)',
    description: 'KIE 提供的 Gemini 3.1 Flash Image。',
    provider: 'kie',
    model: 'nano-banana-2',
    maskEditing: 'supported',
    price: null,
  },
];

const JPEG_QUALITY = 90;
const MAX_SHRINK_ATTEMPTS = 6;

/**
 * Re-encodes a reference image that the selected model cannot take as is: an unsupported format
 * (WebP or GIF for Seedream) becomes PNG when it has transparency, otherwise JPEG, and an image
 * over the model's inline size limit is scaled down until it fits. EXIF rotation is applied.
 */
export const convertReference: ReferenceConverter = async (dataUrl, { acceptedMimeTypes, maxInlineBytes }) => {
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const metadata = await sharp(input).metadata();
  const asPng = Boolean(metadata.hasAlpha) && acceptedMimeTypes.includes('image/png');
  const mimeType = asPng ? 'image/png' : 'image/jpeg';
  let width = metadata.autoOrient?.width ?? metadata.width;
  for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt++) {
    const pipeline = sharp(input).rotate().resize({ width, withoutEnlargement: true });
    const output = await (asPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY })).toBuffer();
    if (output.length <= maxInlineBytes) return `data:${mimeType};base64,${output.toString('base64')}`;
    width = Math.floor((width ?? 4096) * Math.sqrt(maxInlineBytes / output.length) * 0.9);
  }
  throw new Error(`縮小 ${MAX_SHRINK_ATTEMPTS} 次後仍超過 ${(maxInlineBytes / 1_048_576).toFixed(0)} MB`);
};

export const imageClient = createImageClient({
  app: 'infocard',
  models: MODELS,
  env: process.env,
  // InfoCard has always also accepted TOAPI_API_KEY (without the S).
  secretNames: { toapis: ['TOAPIS_API_KEY', 'TOAPI_API_KEY'] },
  convertReference,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});
```

## Step 3: update `server.ts`

Apply this diff. In short:

- Import `handleImageRequest` (from `@hk01/pi-ai-extra-image-kit/server`) and `imageClient`; remove the two provider imports. Keep the `@google/genai` import: the text routes still use it.
- Add `GET /api/image-models`.
- Add 4K output sizes to `getTargetDimensions`, split the resize out of `normalizeImageDimensions` into `resizeImage`, delete `getGeminiAspectRatio`, and add `getImageSize`, `getUprightImage` and `cropToAspect`.
- In each of the five image routes, delete the ToAPIs / OpenRouter branches and the direct Gemini call, keep the prompt parts exactly as they are, and finish with `handleImageRequest(...)`.
- The edit route keeps the original image's aspect ratio and pixel size. The batch route sends every reference image, supports 4K, applies the base photo's EXIF rotation, and for "original" crops the result to the base image's exact aspect.
- The `catch` blocks only answer when nothing was sent yet (`if (!res.headersSent)`), because the image result is streamed.

```diff
diff --git a/server.ts b/server.ts
index 6ecd47f..5be8baa 100644
--- a/server.ts
+++ b/server.ts
@@ -5,8 +5,8 @@ import { GoogleGenAI } from "@google/genai";
 import dotenv from "dotenv";
 import sharp from "sharp";
 import { Converter } from "opencc-js";
-import { generateOpenRouterImage } from "./server/providers/openrouter";
-import { generateToAPIsImage } from "./server/providers/toapis";
+import { handleImageRequest, type ImagePart } from "@hk01/pi-ai-extra-image-kit/server";
+import { imageClient } from "./server/imageModels";
 
 dotenv.config();
 
@@ -28,9 +28,20 @@ const PORT = 3000;
 app.use(express.json({ limit: "50mb" }));
 app.use(express.urlencoded({ limit: "50mb", extended: true }));
 
+// 4K output sizes (batch edit offers 4K for these ratios). Other ratios fall back to their 2K size.
+const DIMENSIONS_4K: Record<string, { width: number; height: number }> = {
+  '4:5': { width: 3200, height: 4000 },
+  '3:4': { width: 3072, height: 4096 },
+  '1:1': { width: 4096, height: 4096 },
+  '16:9': { width: 3840, height: 2160 },
+  '9:16': { width: 2160, height: 3840 },
+  '4:3': { width: 4096, height: 3072 },
+};
+
 // Standard target pixel dimensions
 export const getTargetDimensions = (ratioId: string, resolution: string = '1K') => {
-  const is2K = resolution === '2K';
+  const is2K = resolution === '2K' || resolution === '4K';
+  if (resolution === '4K' && DIMENSIONS_4K[ratioId]) return DIMENSIONS_4K[ratioId];
   switch (ratioId) {
     case '4:5':
       return is2K ? { width: 2400, height: 3000 } : { width: 1200, height: 1500 };
@@ -65,6 +76,12 @@ export const normalizeImageDimensions = async (
   ratioId: string,
   resolution: string = '1K'
 ): Promise<string> => {
+  const { width, height } = getTargetDimensions(ratioId, resolution);
+  return resizeImage(dataUrlOrUrl, width, height);
+};
+
+// Center-crop and resize an image to exact pixel dimensions using sharp
+const resizeImage = async (dataUrlOrUrl: string, width: number, height: number): Promise<string> => {
   if (!dataUrlOrUrl) return dataUrlOrUrl;
   try {
     let inputBuffer: Buffer;
@@ -82,8 +99,6 @@ export const normalizeImageDimensions = async (
       inputBuffer = Buffer.from(dataUrlOrUrl, 'base64');
     }
 
-    const { width, height } = getTargetDimensions(ratioId, resolution);
-
     const sharpInstance = sharp(inputBuffer).resize(width, height, {
       fit: 'cover',
       position: 'center',
@@ -103,17 +118,7 @@ export const normalizeImageDimensions = async (
   }
 };
 
-// Helper to convert internal ratio ID to supported Gemini API aspect ratio
-const getGeminiAspectRatio = (ratioId: string) => {
-  const validAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9", "4:5", "5:4"];
-  if (validAspectRatios.includes(ratioId)) return ratioId;
-  if (ratioId === '300x250' || ratioId === '336x280' || ratioId === '6:5') return '4:3';
-  if (ratioId === '300x300') return '1:1';
-  if (ratioId === '300x600' || ratioId === '320x480') return '9:16';
-  return '1:1';
-};
-
-// Helper to convert base64 data URL to inlineData format for Gemini SDK
+// Helper to convert base64 data URL to an inline image part for @hk01/pi-ai-extra-image-kit
 const getInlineData = (dataUrl: string) => {
   const [header, data] = dataUrl.split(',');
   const mimeType = header.split(':')[1].split(';')[0];
@@ -125,6 +130,11 @@ const getInlineData = (dataUrl: string) => {
   };
 };
 
+// Image models offered by every image feature, with limits and key availability
+app.get("/api/image-models", (_req, res) => {
+  res.json({ models: imageClient.listModels() });
+});
+
 // Image proxy route to prevent canvas CORS contamination
 app.get("/api/proxy-image", async (req, res) => {
   const imageUrl = req.query.url as string;
@@ -168,7 +178,8 @@ app.post("/api/gemini/generate", async (req, res) => {
       modelId,
       eraseTemplateSubject = true,
       lockBrandLogo = true,
-      temperature = 0.7,
+      // Sent only for models that accept it; the image kit rejects it for the others.
+      temperature,
       aiMatting = false,
       forbidPretrainedKnowledge = true,
       imageResolution = '1K',
@@ -179,54 +190,6 @@ app.post("/api/gemini/generate", async (req, res) => {
     const effectiveGlobalPrompt = language === 'sc' ? toServerSimplified(globalPrompt) : globalPrompt;
     const effectiveRatioPrompt = language === 'sc' ? toServerSimplified(ratioPrompt) : ratioPrompt;
 
-    if (modelId === 'gpt-image-2' || modelId === 'doubao-seedream-5-0') {
-      try {
-        const imageUrl = await generateToAPIsImage({
-          modelId,
-          globalPrompt: effectiveGlobalPrompt,
-          ratioPrompt: effectiveRatioPrompt,
-          ratio,
-          templateImage,
-          sourceImages,
-          brandLogo,
-          eraseTemplateSubject,
-          lockBrandLogo,
-          temperature,
-          aiMatting,
-          forbidPretrainedKnowledge,
-          language,
-        });
-        const normalizedUrl = await normalizeImageDimensions(imageUrl, ratio, targetRes);
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        return res.status(500).json({ error: err.message || `${modelId} (ToAPIs) 生成失敗` });
-      }
-    }
-
-    if (modelId === 'openrouter-gpt-image-2') {
-      try {
-        const imageUrl = await generateOpenRouterImage({
-          globalPrompt: effectiveGlobalPrompt,
-          ratioPrompt: effectiveRatioPrompt,
-          ratio,
-          templateImage,
-          sourceImages,
-          brandLogo,
-          eraseTemplateSubject,
-          lockBrandLogo,
-          temperature,
-          aiMatting,
-          forbidPretrainedKnowledge,
-          language,
-        });
-        const normalizedUrl = await normalizeImageDimensions(imageUrl, ratio, targetRes);
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        return res.status(500).json({ error: err.message || "GPT Image 2 (OpenRouter) 生成失敗" });
-      }
-    }
-
-
     if (!templateImage) {
       return res.status(400).json({ error: "Missing templateImage" });
     }
@@ -234,21 +197,7 @@ app.post("/api/gemini/generate", async (req, res) => {
       return res.status(400).json({ error: "Missing or empty sourceImages" });
     }
 
-    const apiKey = process.env.GEMINI_API_KEY;
-    if (!apiKey) {
-      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server. Please check the Secrets panel in Settings." });
-    }
-
-    const ai = new GoogleGenAI({
-      apiKey,
-      httpOptions: {
-        headers: {
-          'User-Agent': 'aistudio-build',
-        }
-      }
-    });
-
-    const parts: any[] = [];
+    const parts: ImagePart[] = [];
 
     // Add template image
     parts.push({ text: "STYLE TEMPLATE (Reference for layout, typography, colors, and overall vibe ONLY. CLEAN SLATE: Do NOT include any people, text, or specific objects from this reference style image in the final output):" });
@@ -317,87 +266,28 @@ ${effectiveRatioPrompt}
 
     parts.push({ text: fullPrompt });
 
-    // Map to standard models
-    const actualModelId = modelId === 'nano-banana-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
-
-    const response = await ai.models.generateContent({
-      model: actualModelId,
-      contents: { parts },
-      config: {
-        temperature: typeof temperature === 'number' ? temperature : 0.7,
-        imageConfig: {
-          aspectRatio: getGeminiAspectRatio(ratio) as any,
-          imageSize: targetRes,
-        }
-      }
-    });
-
-    let foundImage = false;
-    for (const part of response.candidates?.[0]?.content?.parts || []) {
-      if (part.inlineData) {
-        const base64EncodeString = part.inlineData.data;
-        const mimeType = part.inlineData.mimeType || 'image/jpeg';
-        const dataUrl = `data:${mimeType};base64,${base64EncodeString}`;
-        const normalizedUrl = await normalizeImageDimensions(dataUrl, ratio, targetRes);
-        
-        foundImage = true;
-        return res.json({ imageUrl: normalizedUrl });
-      }
-    }
-
-    if (!foundImage) {
-      throw new Error("No image generated by the Gemini model response");
-    }
-
+    await handleImageRequest(
+      res,
+      imageClient,
+      { appModelId: modelId, parts, aspectRatio: ratio, resolution: targetRes, temperature },
+      async (image) => ({ imageUrl: await normalizeImageDimensions(image.dataUrl, ratio, targetRes) }),
+    );
   } catch (error: any) {
     console.error("Error in generate API:", error);
-    res.status(500).json({ error: error.message || "Unknown server error occurred" });
+    if (!res.headersSent) res.status(500).json({ error: error.message || "Unknown server error occurred" });
   }
 });
 
-// API Endpoint for editing OG image
+// API Endpoint for editing OG image (DeepEditor in the OG, InfoCard and possession tabs)
 app.post("/api/gemini/edit", async (req, res) => {
   try {
     const {
       baseImage,
       editPrompt,
-      ratio,
       modelId,
       language = 'tc',
     } = req.body;
 
-    const effectiveEditPrompt = language === 'sc' ? toServerSimplified(editPrompt) : editPrompt;
-
-    if (modelId === 'gpt-image-2' || modelId === 'doubao-seedream-5-0') {
-      try {
-        const imageUrl = await generateToAPIsImage({
-          modelId,
-          editPrompt: effectiveEditPrompt,
-          ratio,
-          baseImage,
-          language,
-        });
-        const normalizedUrl = await normalizeImageDimensions(imageUrl, ratio, '1K');
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        return res.status(500).json({ error: err.message || `${modelId} (ToAPIs) 編輯失敗` });
-      }
-    }
-
-    if (modelId === 'openrouter-gpt-image-2') {
-      try {
-        const imageUrl = await generateOpenRouterImage({
-          editPrompt: effectiveEditPrompt,
-          ratio,
-          language,
-        });
-        const normalizedUrl = await normalizeImageDimensions(imageUrl, ratio, '1K');
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        return res.status(500).json({ error: err.message || "GPT Image 2 (OpenRouter) 編輯失敗" });
-      }
-    }
-
     if (!baseImage) {
       return res.status(400).json({ error: "Missing baseImage" });
     }
@@ -405,24 +295,17 @@ app.post("/api/gemini/edit", async (req, res) => {
       return res.status(400).json({ error: "Missing editPrompt" });
     }
 
-    const apiKey = process.env.GEMINI_API_KEY;
-    if (!apiKey) {
-      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server. Please check the Secrets panel in Settings." });
+    const effectiveEditPrompt = language === 'sc' ? toServerSimplified(editPrompt) : editPrompt;
+    // The edit keeps the original image's aspect ratio and pixel size.
+    const baseSize = await getImageSize(baseImage);
+    if (!baseSize) {
+      return res.status(400).json({ error: "無法讀取原圖的尺寸，請重新載入圖片後再試。" });
     }
 
-    const ai = new GoogleGenAI({
-      apiKey,
-      httpOptions: {
-        headers: {
-          'User-Agent': 'aistudio-build',
-        }
-      }
-    });
-
-    const parts: any[] = [];
+    const parts: ImagePart[] = [];
 
     parts.push({ text: "ORIGINAL IMAGE TO EDIT:" });
-    parts.push(getInlineData(baseImage));
+    parts.push(await ensureInlineData(baseImage));
 
     const fullPrompt = `
 You are an expert image editor. Your task is to apply the requested edits to the provided image.
@@ -439,40 +322,21 @@ ${effectiveEditPrompt}
 
     parts.push({ text: fullPrompt });
 
-    // Map to standard models
-    const actualModelId = modelId === 'nano-banana-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
-
-    const response = await ai.models.generateContent({
-      model: actualModelId,
-      contents: { parts },
-      config: {
-        imageConfig: {
-          aspectRatio: getGeminiAspectRatio(ratio) as any,
-          imageSize: "2K",
-        }
-      }
-    });
-
-    let foundImage = false;
-    for (const part of response.candidates?.[0]?.content?.parts || []) {
-      if (part.inlineData) {
-        const base64EncodeString = part.inlineData.data;
-        const mimeType = part.inlineData.mimeType || 'image/jpeg';
-        const dataUrl = `data:${mimeType};base64,${base64EncodeString}`;
-        const normalizedUrl = await normalizeImageDimensions(dataUrl, ratio, '1K');
-        
-        foundImage = true;
-        return res.json({ imageUrl: normalizedUrl });
-      }
-    }
-
-    if (!foundImage) {
-      throw new Error("No image generated by the Gemini model response");
-    }
-
+    await handleImageRequest(
+      res,
+      imageClient,
+      {
+        appModelId: modelId,
+        parts,
+        aspectRatio: `${baseSize.width}:${baseSize.height}`,
+        keepInputAspect: true,
+        resolution: '2K',
+      },
+      async (image) => ({ imageUrl: await resizeImage(image.dataUrl, baseSize.width, baseSize.height) }),
+    );
   } catch (error: any) {
     console.error("Error in edit API:", error);
-    res.status(500).json({ error: error.message || "Unknown server error occurred" });
+    if (!res.headersSent) res.status(500).json({ error: error.message || "Unknown server error occurred" });
   }
 });
 
@@ -782,54 +646,7 @@ app.post("/api/infocard/generate-card", async (req, res) => {
       return res.status(400).json({ error: "請提供樣板圖片以供風格參考" });
     }
 
-    if (modelId === 'gpt-image-2' || modelId === 'doubao-seedream-5-0') {
-      try {
-        const composedPrompt = `
-Social Media InfoCard (${cardType === 'cover' ? 'Cover Hook Card' : `Content Card #${cardIndex}`}).
-Main Title: ${effectiveMainTitle}
-Subtitle: ${effectiveSubTitle}
-Minor Title: ${effectiveMinorTitle}
-Body: ${effectiveBody}
-Tags: ${effectiveTags}
-Visual Subject Prompt: ${imagePrompt}
-`;
-        const imageUrl = await generateToAPIsImage({
-          modelId,
-          globalPrompt: composedPrompt,
-          ratioPrompt: `Ratio: ${ratio}, Resolution: ${resolution}`,
-          ratio,
-          templateImage,
-          sourceImages,
-          brandLogo,
-          eraseTemplateSubject: eraseTemplateText,
-          lockBrandLogo,
-          temperature: 0.7,
-          aiMatting: false,
-          forbidPretrainedKnowledge: forbidPretrainedLogo,
-          language,
-        });
-        const normalizedUrl = await normalizeImageDimensions(imageUrl, ratio, resolution);
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        return res.status(500).json({ error: err.message || `${modelId} (ToAPIs) 生成失敗` });
-      }
-    }
-
-    const apiKey = process.env.GEMINI_API_KEY;
-    if (!apiKey) {
-      return res.status(500).json({ error: "GEMINI_API_KEY 未配置在伺服器端。" });
-    }
-
-    const ai = new GoogleGenAI({
-      apiKey,
-      httpOptions: {
-        headers: {
-          'User-Agent': 'aistudio-build',
-        }
-      }
-    });
-
-    const parts: any[] = [];
+    const parts: ImagePart[] = [];
 
     // 1. Reference Style Template Image
     parts.push({
@@ -914,38 +731,16 @@ ${textNegativePrompt}
 
     parts.push({ text: fullInstruction });
 
-    const actualModelId = modelId === 'nano-banana-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
-
-    const response = await ai.models.generateContent({
-      model: actualModelId,
-      contents: { parts },
-      config: {
-        imageConfig: {
-          aspectRatio: getGeminiAspectRatio(ratio) as any,
-          imageSize: resolution === '2K' ? '2K' : '1K',
-        }
-      }
-    });
-
-    let foundImage = false;
-    for (const part of response.candidates?.[0]?.content?.parts || []) {
-      if (part.inlineData) {
-        const base64EncodeString = part.inlineData.data;
-        const mimeType = part.inlineData.mimeType || 'image/jpeg';
-        const dataUrl = `data:${mimeType};base64,${base64EncodeString}`;
-        const normalizedUrl = await normalizeImageDimensions(dataUrl, ratio, resolution);
-        foundImage = true;
-        return res.json({ imageUrl: normalizedUrl });
-      }
-    }
-
-    if (!foundImage) {
-      throw new Error("模型未返回生成的圖卡影像");
-    }
-
+    const targetRes = resolution === '2K' ? '2K' : '1K';
+    await handleImageRequest(
+      res,
+      imageClient,
+      { appModelId: modelId, parts, aspectRatio: ratio, resolution: targetRes },
+      async (image) => ({ imageUrl: await normalizeImageDimensions(image.dataUrl, ratio, targetRes) }),
+    );
   } catch (error: any) {
     console.error("Error in generate-card API:", error);
-    res.status(500).json({ error: error.message || "圖卡生成失敗" });
+    if (!res.headersSent) res.status(500).json({ error: error.message || "圖卡生成失敗" });
   }
 });
 
@@ -977,6 +772,47 @@ const ensureInlineData = async (dataUrlOrUrl: string) => {
   };
 };
 
+// Pixel size of an image as displayed (EXIF rotation applied), or null when it cannot be read
+const getImageSize = async (dataUrlOrUrl: string): Promise<{ width: number; height: number } | null> => {
+  try {
+    const metadata = await sharp(await getBufferFromUrlOrDataUrl(dataUrlOrUrl)).metadata();
+    const width = metadata.autoOrient?.width ?? metadata.width;
+    const height = metadata.autoOrient?.height ?? metadata.height;
+    return width && height ? { width, height } : null;
+  } catch (err) {
+    console.warn('Image size read warning:', err);
+    return null;
+  }
+};
+
+// Applies EXIF rotation, so the pixels sent to the model match what the user saw (and drew masks on).
+// An image sharp cannot read is returned unchanged; the later checks reject it with a clear message.
+const getUprightImage = async (dataUrlOrUrl: string): Promise<string> => {
+  try {
+    const input = await getBufferFromUrlOrDataUrl(dataUrlOrUrl);
+    const metadata = await sharp(input).metadata();
+    if (!metadata.orientation || metadata.orientation === 1) return dataUrlOrUrl;
+    const rotated = sharp(input).rotate();
+    const output = metadata.hasAlpha ? await rotated.png().toBuffer() : await rotated.jpeg({ quality: 95 }).toBuffer();
+    return `data:image/${metadata.hasAlpha ? 'png' : 'jpeg'};base64,${output.toString('base64')}`;
+  } catch (err) {
+    console.warn('Image orientation warning:', err);
+    return dataUrlOrUrl;
+  }
+};
+
+// Center-crops an image to the aspect of width:height, keeping its own resolution
+const cropToAspect = async (dataUrl: string, width: number, height: number): Promise<string> => {
+  const size = await getImageSize(dataUrl);
+  if (!size) return dataUrl;
+  const target = width / height;
+  const cropped = size.width / size.height > target
+    ? { width: Math.round(size.height * target), height: size.height }
+    : { width: size.width, height: Math.round(size.width / target) };
+  if (cropped.width === size.width && cropped.height === size.height) return dataUrl;
+  return resizeImage(dataUrl, cropped.width, cropped.height);
+};
+
 // Helper: Stamp logo on image using Sharp with exact positioning and opacity
 const stampLogoOnImage = async (
   baseImageDataUrl: string,
@@ -1219,78 +1055,7 @@ app.post("/api/possession/generate", async (req, res) => {
       ? (Array.isArray(badges) ? badges.map((b: string) => toServerSimplified(b)) : [])
       : badges;
 
-    // Support GPT Image 2 (ToAPIs)
-    if (imageModel === 'gpt-image-2') {
-      try {
-        const badgeText = Array.isArray(effectiveBadges) && effectiveBadges.length > 0 ? effectiveBadges.join(' | ') : '';
-        const possessionDirectives = `
-[OG 奪舍 METAMORPHOSIS & TYPOGRAPHY DIRECTIVES]:
-1. REFERENCE STYLE TEMPLATE (排版骨架與風格來源):
-   - Strictly adopt and replicate the overall layout composition, background graphic framing, color palette, lighting glow, atmospheric aesthetic, and typography font weight/extrusion from the style template image.
-   ${eraseTemplateSubject ? '- RIGID PURGE & CLEAN SLATE (嚴格清除舊主體與文字): Completely remove and erase all original characters, people, faces, and old text titles from this template image. The template provides ONLY background layout, color harmony, and font style.' : ''}
-
-2. NEW MATERIAL SOURCE IMAGE (唯一人物與產品來源):
-   - ${lockFacialIdentity ? '100% pixel-perfect clone and preserve the face, facial expression, eyes, gaze, nose, smile, skin texture, and hairstyle from this material image. Strictly zero facial distortion, AI beautification, aging, or identity morphing.' : 'Integrate the subject from this material image.'}
-   - ${lockProductDetails ? '100% preserve and clone the exact products, devices, props, model details, outer silhouettes, reflections, and proportions from this material image.' : 'Integrate the key products from this image.'}
-   - Seamlessly blend the subjects into the template background with natural lighting and contact shadows, without carrying over the raw background of the material image.
-
-3. INJECTED TITLES & ${isSimp ? 'SIMPLIFIED' : 'TRADITIONAL'} CHINESE TYPOGRAPHY:
-   - 核心主標題 (Main Title): "${effectiveMainTitle}"
-   ${effectiveSubtitle ? `- 副標題 (Subtitle): "${effectiveSubtitle}"` : ''}
-   ${badgeText ? `- 亮點標籤 / 促銷徽章 (Badges): "${badgeText}"` : ''}
-   - Render the title using the exact 3D extrusion, stroke outline, gradient fill, and drop shadow matching the reference template.
-   - All text MUST strictly be in accurate, standard ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体字。' : 'Traditional Chinese (繁體中文).' }
-   - Ensure the text title does NOT block or obscure the human face or key products.
-
-4. BRAND LOGO LOCK:
-   ${brandLogo ? '- 100% pixel-perfect copy and position the provided Brand Logo in the corner (top-left or top-right).' : lockBrandLogo ? '- If there is a brand logo in the reference template (usually top-left or top-right), 100% pixel-perfect preserve and lock it in the exact same location without distortion.' : ''}
-
-5. ANTI-CYBERPUNK & 1K DEFINITION:
-   - NO CYBERPUNK: Absolutely DO NOT use cyberpunk, neon-grid, or glitchy sci-fi themes. Maintain high-end editorial and clean professional aesthetic.
-   - 1K RESOLUTION: Optimize for sharp, crystal-clear 1K image definition at target aspect ratio (${ratio}).
-${customPrompt ? `\nUSER SPECIFIC DIRECTIVE:\n${customPrompt}\n` : ''}
-`;
-
-        const imageUrl = await generateToAPIsImage({
-          modelId: 'gpt-image-2',
-          globalPrompt: possessionDirectives,
-          ratioPrompt: `Target ratio: ${ratio}. Safe margin: keep all titles, logos, and critical focal subjects within the safe viewing canvas.`,
-          ratio,
-          templateImage,
-          sourceImages: [materialImage],
-          brandLogo,
-          eraseTemplateSubject,
-          lockBrandLogo,
-          forbidPretrainedKnowledge: true,
-          language,
-        });
-
-        const normalizedUrl = await normalizeImageDimensions(imageUrl, ratio, '1K');
-        return res.json({
-          imageUrl: normalizedUrl,
-          metadata: {
-            ratio,
-            model: 'gpt-image-2',
-            timestamp: Date.now()
-          }
-        });
-      } catch (err: any) {
-        console.error("GPT Image 2 (ToAPIs) possession error:", err);
-        return res.status(500).json({ error: err.message || "GPT Image 2 (ToAPIs) OG 奪舍生成失敗" });
-      }
-    }
-
-    const apiKey = process.env.GEMINI_API_KEY;
-    if (!apiKey) {
-      return res.status(500).json({ error: "GEMINI_API_KEY 未配置在伺服器端。" });
-    }
-
-    const ai = new GoogleGenAI({
-      apiKey,
-      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
-    });
-
-    const parts: any[] = [];
+    const parts: ImagePart[] = [];
 
     // Part 1: Reference Style Template
     const templateInstruction = `
@@ -1353,48 +1118,22 @@ ${customPrompt ? `\nUSER SPECIFIC DIRECTIVE:\n${customPrompt}\n` : ''}
 `;
     parts.push({ text: masterDirectives });
 
-    // Model selection: strictly Nano Banana 2 (gemini-3.1-flash-image) or Nano Banana Pro (gemini-3-pro-image)
-    const actualModel = imageModel === 'nano-banana-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
-    const targetGeminiRatio = getGeminiAspectRatio(ratio);
-
-    const response = await ai.models.generateContent({
-      model: actualModel,
-      contents: { parts },
-      config: {
-        imageConfig: {
-          aspectRatio: targetGeminiRatio as any,
-          imageSize: '1K', // User constraint: always 1K priority
-        }
-      }
-    });
-
-    let foundImageUrl: string | null = null;
-    for (const part of response.candidates?.[0]?.content?.parts || []) {
-      if (part.inlineData) {
-        const base64Data = part.inlineData.data;
-        const mimeType = part.inlineData.mimeType || 'image/jpeg';
-        const rawUrl = `data:${mimeType};base64,${base64Data}`;
-        foundImageUrl = await normalizeImageDimensions(rawUrl, ratio, '1K');
-        break;
-      }
-    }
-
-    if (!foundImageUrl) {
-      throw new Error("模型未返回生成的 OG 奪舍圖片，請稍後再試。");
-    }
-
-    return res.json({
-      imageUrl: foundImageUrl,
-      metadata: {
-        ratio,
-        model: imageModel,
-        timestamp: Date.now()
-      }
-    });
-
+    await handleImageRequest(
+      res,
+      imageClient,
+      { appModelId: imageModel, parts, aspectRatio: ratio, resolution: '1K' },
+      async (image) => ({
+        imageUrl: await normalizeImageDimensions(image.dataUrl, ratio, '1K'),
+        metadata: {
+          ratio,
+          model: imageModel,
+          timestamp: Date.now(),
+        },
+      }),
+    );
   } catch (error: any) {
     console.error("Error in possession generate API:", error);
-    res.status(500).json({ error: error.message || "OG 奪舍生成失敗" });
+    if (!res.headersSent) res.status(500).json({ error: error.message || "OG 奪舍生成失敗" });
   }
 });
 
@@ -1460,14 +1199,16 @@ app.post("/api/batch-edit/process-image", async (req, res) => {
     const effectiveDedicatedPrompt = isSimp ? toServerSimplified(dedicatedPrompt) : dedicatedPrompt;
 
     const hasImage = Boolean(image && typeof image === 'string' && image.trim().length > 0);
+    const baseImage = hasImage ? await getUprightImage(image) : null;
     const combinedPrompt = [effectiveDedicatedPrompt?.trim(), effectiveGlobalPrompt?.trim()].filter(Boolean).join("\n\n");
 
     if (!hasImage && !combinedPrompt) {
       return res.status(400).json({ error: "留空底圖時（文生圖模式），請輸入提示詞指令以生成圖片。" });
     }
 
+    // Every reference image is sent; the image kit rejects more than the selected model accepts.
     const validReferenceImages = Array.isArray(referenceImages)
-      ? referenceImages.filter((img): img is string => Boolean(img && typeof img === 'string')).slice(0, 5)
+      ? referenceImages.filter((img): img is string => Boolean(img && typeof img === 'string'))
       : [];
 
     const styleReferenceDirective = validReferenceImages.length > 0
@@ -1477,103 +1218,7 @@ app.post("/api/batch-edit/process-image", async (req, res) => {
 3. COMPOSITION & RATIO: The spatial composition, scene arrangement, and subject matter MUST STRICTLY follow the user's prompt directive and the target aspect ratio (${aspectRatio}).`
       : '';
 
-    if (modelId === 'gpt-image-2' || modelId === 'doubao-seedream-5-0') {
-      try {
-        const targetRatio = (aspectRatio === 'original' || !aspectRatio) ? '4:5' : aspectRatio;
-        let imageUrl: string;
-        if (hasImage) {
-          const editPrompt = `You are an expert image editor and generative enhancement engine.
-Apply the requested photographic modifications to the provided image:
-Global instructions: ${effectiveGlobalPrompt || 'Photographic enhancement and realistic touch-up.'}
-Dedicated instructions: ${effectiveDedicatedPrompt || 'Follow global directive with high fidelity.'}
-${maskImage ? 'Note: White pixels on inpaint mask indicate target edit region.' : ''}
-${styleReferenceDirective}
-All in-image text MUST strictly be in ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).'}`;
-          imageUrl = await generateToAPIsImage({
-            modelId,
-            editPrompt,
-            ratio: targetRatio,
-            baseImage: image,
-            sourceImages: validReferenceImages.length > 0 ? validReferenceImages : undefined,
-            language,
-          });
-        } else {
-          const subjectAwarePrompt = `[CORE SUBJECT MANDATE: The user's input specifies the primary subject (e.g. cars, products, objects, scenery). Any style directive defines ONLY the lighting, color grading, materials, and atmosphere. DO NOT generate human dancers, idols, or models unless requested].\nPrompt Directive: ${combinedPrompt}${styleReferenceDirective}\nAll in-image text MUST strictly be in ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).'}`;
-          imageUrl = await generateToAPIsImage({
-            modelId,
-            globalPrompt: subjectAwarePrompt,
-            ratioPrompt: `Ratio: ${targetRatio}, Resolution: ${resolution}`,
-            ratio: targetRatio,
-            sourceImages: validReferenceImages.length > 0 ? validReferenceImages : undefined,
-            language,
-          });
-        }
-
-        let normalizedUrl = await normalizeImageDimensions(imageUrl, targetRatio, resolution);
-
-        if (logoConfig && logoConfig.logoUrl) {
-          normalizedUrl = await stampLogoOnImage(normalizedUrl, logoConfig);
-        }
-
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        console.error("ToAPIs batch image error:", err);
-        return res.status(500).json({ error: err.message || `${modelId} (ToAPIs) 批次處理失敗` });
-      }
-    }
-
-    if (modelId === 'openrouter-gpt-image-2') {
-      try {
-        const targetRatio = (aspectRatio === 'original' || !aspectRatio) ? '4:5' : aspectRatio;
-        let imageUrl: string;
-        if (hasImage) {
-          const editPrompt = `You are an expert image editor and generative enhancement engine.
-Apply the requested photographic modifications to the provided image:
-Global instructions: ${effectiveGlobalPrompt || 'Photographic enhancement and realistic touch-up.'}
-Dedicated instructions: ${effectiveDedicatedPrompt || 'Follow global directive with high fidelity.'}
-${styleReferenceDirective}
-All in-image text MUST strictly be in ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).'}`;
-          imageUrl = await generateOpenRouterImage({
-            editPrompt,
-            ratio: targetRatio,
-            sourceImages: validReferenceImages.length > 0 ? validReferenceImages : undefined,
-            language,
-          });
-        } else {
-          const subjectAwarePrompt = `[CORE SUBJECT MANDATE: The user's input specifies the primary subject (e.g. cars, products, objects, scenery). Any style directive defines ONLY the lighting, color grading, materials, and atmosphere. DO NOT generate human dancers, idols, or models unless requested].\nPrompt Directive: ${combinedPrompt}${styleReferenceDirective}\nAll in-image text MUST strictly be in ${isSimp ? 'Simplified Chinese (简体中文). 严禁繁体中文。' : 'Traditional Chinese (繁體中文).'}`;
-          imageUrl = await generateOpenRouterImage({
-            globalPrompt: subjectAwarePrompt,
-            ratioPrompt: `Ratio: ${targetRatio}, Resolution: ${resolution}`,
-            ratio: targetRatio,
-            sourceImages: validReferenceImages.length > 0 ? validReferenceImages : undefined,
-            language,
-          });
-        }
-
-        let normalizedUrl = await normalizeImageDimensions(imageUrl, targetRatio, resolution);
-
-        if (logoConfig && logoConfig.logoUrl) {
-          normalizedUrl = await stampLogoOnImage(normalizedUrl, logoConfig);
-        }
-
-        return res.json({ imageUrl: normalizedUrl });
-      } catch (err: any) {
-        console.error("OpenRouter batch image error:", err);
-        return res.status(500).json({ error: err.message || "GPT Image 2 (OpenRouter) 批次處理失敗" });
-      }
-    }
-
-    const apiKey = process.env.GEMINI_API_KEY;
-    if (!apiKey) {
-      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
-    }
-
-    const ai = new GoogleGenAI({
-      apiKey,
-      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
-    });
-
-    const parts: any[] = [];
+    const parts: ImagePart[] = [];
 
     // Attach style reference images (up to 5) if provided
     if (validReferenceImages.length > 0) {
@@ -1593,7 +1238,7 @@ MANDATORY STYLE TRANSFER DIRECTIVE:
     if (hasImage) {
       // Image-to-Image mode
       parts.push({ text: "SOURCE BASE IMAGE (The core image to edit, inpaint, or transform):" });
-      parts.push(await ensureInlineData(image));
+      parts.push(await ensureInlineData(baseImage));
 
       // Add inpaint mask if user provided one
       if (maskImage) {
@@ -1646,48 +1291,41 @@ ${styleReferenceDirective}
       parts.push({ text: textToImageInstruction });
     }
 
-    const actualModelId = modelId === 'nano-banana-pro' ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image';
-    const targetGeminiRatio = aspectRatio === 'original' ? '1:1' : getGeminiAspectRatio(aspectRatio);
-
-    const response = await ai.models.generateContent({
-      model: actualModelId,
-      contents: { parts },
-      config: {
-        imageConfig: {
-          aspectRatio: targetGeminiRatio as any,
-          imageSize: resolution === '4K' || resolution === '2K' ? '2K' : '1K',
-        }
-      }
-    });
-
-    let foundImageUrl: string | null = null;
-    for (const part of response.candidates?.[0]?.content?.parts || []) {
-      if (part.inlineData) {
-        const base64EncodeString = part.inlineData.data;
-        const mimeType = part.inlineData.mimeType || 'image/jpeg';
-        foundImageUrl = `data:${mimeType};base64,${base64EncodeString}`;
-        break;
-      }
-    }
-
-    if (!foundImageUrl) {
-      throw new Error("模型未返回生成的影像，請稍後重試。");
-    }
-
-    // Normalize image dimensions to target ratio and resolution
-    if (aspectRatio && aspectRatio !== 'original') {
-      foundImageUrl = await normalizeImageDimensions(foundImageUrl, aspectRatio, resolution);
-    }
-
-    // If logoConfig is provided, stamp logo onto the generated image using Sharp
-    if (logoConfig && logoConfig.logoUrl) {
-      foundImageUrl = await stampLogoOnImage(foundImageUrl, logoConfig);
+    const targetRes = resolution === '4K' ? '4K' : resolution === '2K' ? '2K' : '1K';
+    // "original" keeps the base image's aspect; a slot without a base image (text-to-image) is 1:1.
+    const keepOriginal = !aspectRatio || aspectRatio === 'original';
+    const baseSize = keepOriginal && baseImage ? await getImageSize(baseImage) : null;
+    if (keepOriginal && hasImage && !baseSize) {
+      return res.status(400).json({ error: "無法讀取底圖的尺寸，請重新上載底圖後再試。" });
     }
-
-    return res.json({ imageUrl: foundImageUrl });
+    const aspect = !keepOriginal
+      ? { aspectRatio }
+      : baseSize
+        ? { aspectRatio: `${baseSize.width}:${baseSize.height}`, keepInputAspect: true }
+        : { aspectRatio: '1:1' };
+
+    await handleImageRequest(
+      res,
+      imageClient,
+      { appModelId: modelId, parts, resolution: targetRes, ...aspect },
+      async (generated) => {
+        // Normalize image dimensions to target ratio and resolution; "original" keeps the base image's
+        // exact aspect at the generated size (models without that ratio return the nearest one)
+        let imageUrl = !keepOriginal
+          ? await normalizeImageDimensions(generated.dataUrl, aspectRatio, targetRes)
+          : baseSize
+            ? await cropToAspect(generated.dataUrl, baseSize.width, baseSize.height)
+            : generated.dataUrl;
+        // If logoConfig is provided, stamp logo onto the generated image using Sharp
+        if (logoConfig && logoConfig.logoUrl) {
+          imageUrl = await stampLogoOnImage(imageUrl, logoConfig);
+        }
+        return { imageUrl };
+      },
+    );
   } catch (error: any) {
     console.error("Error in process-image API:", error);
-    res.status(500).json({ error: error.message || "圖片處理演算失敗" });
+    if (!res.headersSent) res.status(500).json({ error: error.message || "圖片處理演算失敗" });
   }
 });
```

## Step 4: delete the old providers

Delete `server/providers/toapis.ts` and `server/providers/openrouter.ts`. Nothing imports them any more.

## Step 5: `.env.example`

Document the new secrets:

```diff
diff --git a/.env.example b/.env.example
index f01bbbb..54a7cc8 100644
--- a/.env.example
+++ b/.env.example
@@ -8,8 +8,9 @@ GEMINI_API_KEY="MY_GEMINI_API_KEY"
 # Used for self-referential links, OAuth callbacks, and API endpoints.
 APP_URL="MY_APP_URL"
 
-# OPENROUTER_API_KEY: Required for OpenRouter API calls (e.g., GPT Image 2).
-OPENROUTER_API_KEY="MY_OPENROUTER_API_KEY"
+# KIE_API_KEY: Required for the KIE image models (Nano Banana 2, GPT Image 2, Grok Imagine 2.0).
+KIE_API_KEY="MY_KIE_API_KEY"
 
-# TOAPI_API_KEY: Required for ToAPIs API calls (e.g., gpt-image-2, doubao-seedream-5-0).
-TOAPI_API_KEY="MY_TOAPI_API_KEY"
+# TOAPIS_API_KEY: Required for the ToAPIs image models (GPT Image 2 / 2.5, Seedream 5.0 Pro, Nano Banana 2 Preview).
+# The older name TOAPI_API_KEY is still accepted.
+TOAPIS_API_KEY="MY_TOAPIS_API_KEY"
```

## Step 6: check Part 1

1. `npm run lint` passes.
2. `server.ts` no longer contains `generateToAPIsImage`, `generateOpenRouterImage`, `getGeminiAspectRatio` or `.slice(0, 5)`.
3. Reply with a summary of every file you created, changed or deleted.

The image tools will not work again until Parts 2 and 3 are done: the server now streams NDJSON, which the current browser code cannot read yet.
