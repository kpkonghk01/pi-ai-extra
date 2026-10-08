# Task: move InfoCard to the image-kit 0.2 catalogue policy

You are editing the current Google AI Studio InfoCard app: React + Vite client and ESM Express `server.ts`. It already uses `@hk01/pi-ai-extra-image-kit` 0.1 with a static model list in `server/imageModels.ts`, and a `postinstall` script that patches Nano Banana 2.1 into the installed Google package. Use the files present in the app now; apply each step by intent where the code has drifted from the excerpts below.

After this migration the app stops maintaining a model allowlist. image-kit 0.2 offers every model **family** declared by the installed Google, ToAPIs and KIE packages, so a later provider package upgrade adds its new models without editing this app. A family is one selector entry; image-kit chooses the provider's text-to-image or image-to-image operation from whether the request has reference images. Google 0.3.2 declares Nano Banana 2.1 itself, so the `node_modules` patch is removed.

## Preconditions

1. All four release assets in Step 1 must exist and download anonymously. If any is missing, stop and report it; do not substitute another version.
2. Export/download the app before editing. AI Studio has no Git; the export is the rollback point.
3. Keep the `build` and `start` scripts unchanged (ESM, `dist/server.mjs`).

## Rules

1. **One request, one selected provider family.** No model, provider, host or billed retry fallback; no silent reference-image removal.
2. **Canonical model IDs.** UI state, request bodies, history records and logs use `provider:familyId` (for example `google:gemini-nano-banana-2.1`, `kie:gpt-image-2`). Old IDs are not routed: a stored old ID resets to the default once the tool's model list loads. Add no alias that maps an old ID to a model.
3. **Route-owned scopes.** Each image route uses one fixed scope:

   | Route | Tool | Scope |
   | --- | --- | --- |
   | `POST /api/gemini/generate` | OG 拼貼 (`src/App.tsx`) | `og` |
   | `POST /api/infocard/generate-card` | InfoCard (`InfoCardExpert`) | `infocard` |
   | `POST /api/possession/generate` | OG 奪舍 (`PossessionExpert`) | `possession` |
   | `POST /api/batch-edit/process-image` | Batch (`BatchExpert`) | `batch` |
   | `POST /api/gemini/edit` | DeepEditor (opened from OG, InfoCard and possession) | `editor` |

   A request body never selects a scope. The browser asks `GET /api/image-models?scope=…` for the list matching the route it will call.
4. **Provider transport stays in the packages.** Add no provider endpoint, payload, model-ID mapping or catalogue metadata to the app, and never patch `node_modules`.
5. **Keep everything else.** Prompts, text routes using `@google/genai` (`/api/infocard/analyze-article`, `/api/possession/extract-material`, `/api/batch-edit/prompt-magic`), image post-processing, the reference converter, Firebase and history stay as they are. Keep `@google/genai` in `package.json`.
6. **Use only these image-kit exports:**
   - server: `createImageClient`, `handleImageRequest`, `imageErrorBody`, `type CataloguePolicy`, `type ImagePart`, `type ReferenceConverter` from `@hk01/pi-ai-extra-image-kit/server`;
   - root: the helpers already imported from `@hk01/pi-ai-extra-image-kit` (`selectedModelIssue`, `temperatureFor`, `TEMPERATURE_SUPPORT_NOTE`, `MASK_REFERENCE_ONLY_NOTE`, `estimateImageCostUsd`, types);
   - browser and React: the symbols already imported from `/browser` and `/react`.

   `ImageModelOption` and the `models` config field no longer exist in 0.2.

## Step 1: dependencies and the Google patch

1. In `package.json`, replace the four `@hk01/pi-ai-extra-*` entries with exactly these. image-kit 0.2.0 requires these provider versions or newer, so update all four together:

   ```json
   "@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.2/hk01-pi-ai-extra-google-0.3.2.tgz",
   "@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz",
   "@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.2.0/hk01-pi-ai-extra-kie-0.2.0.tgz",
   "@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.2.0/hk01-pi-ai-extra-toapis-0.2.0.tgz"
   ```

2. Remove the `"postinstall": "node scripts/patch-google-models.mjs"` script. Change no other script.
3. Delete `scripts/patch-google-models.mjs`, and the `scripts/` folder if it is then empty.
4. Run a clean install (delete `node_modules` first if AI Studio allows it) so no patched Google files remain.

## Step 2: replace `server/imageModels.ts`

Replace the whole file with the following. The reference converter is unchanged; the labels, descriptions, prices and mask-editing values are the app's current ones, keyed by canonical ID.

```ts
import sharp from 'sharp';
import { createImageClient, type CataloguePolicy, type ReferenceConverter } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * InfoCard's catalogue policy and the route-owned image clients. Every image model family in the
 * installed Google, ToAPIs and KIE packages is offered, so a provider package upgrade adds its new
 * families. Limits and capabilities come from the catalogues; this file only holds InfoCard's own
 * labels, verified prices and mask-editing guidance.
 */

export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';

const POLICY: CataloguePolicy = {
  overrides: {
    'google:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1',
      description: '預設模型，Google 直連 Gemini Nano Banana 2.1，生成速度快且細節優質。',
      maskEditing: 'supported',
      // Google pricing page: image output $60 / 1M tokens, input $0.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3.1-flash-image': {
      label: 'Nano Banana 2',
      description: 'Google 直連 Gemini 3.1 Flash Image，生成速度快。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-06): image output $60 / 1M tokens, input $0.50 / 1M tokens.
      price: { perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, inputPerMillionTokensUsd: 0.5 },
    },
    'google:gemini-3-pro-image': {
      label: 'Nano Banana Pro',
      description: '進階模型，Google 直連 Gemini 3 Pro Image，細節更豐富。',
      maskEditing: 'supported',
      // Google pricing page (2026-10-06): image output $120 / 1M tokens, input $2.00 / 1M tokens.
      price: { perImageUsd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 }, inputPerMillionTokensUsd: 2 },
    },
    'toapis:gemini-3.1-flash-image-preview': {
      label: 'Nano Banana 2 Preview (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
      maskEditing: 'supported',
    },
    'toapis:gpt-image-2': {
      label: 'GPT Image 2 (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2，高創意度與畫面品質。',
    },
    'toapis:gpt-image-2.5-flare': {
      label: 'GPT Image 2.5 Flare (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Flare，支援參考圖輸入。',
      // ToAPIs GPT Image 2.5 doc (verified 2026-09-09); reference images have no extra fee.
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02, '4K': 0.025 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:gpt-image-2.5-sunburst': {
      label: 'GPT Image 2.5 Sunburst (ToAPIs)',
      description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst，支援參考圖輸入。',
      price: { perImageUsd: { '1K': 0.015, '2K': 0.02, '4K': 0.025 }, inputPerMillionTokensUsd: 0 },
    },
    'toapis:doubao-seedream-5-0-pro': {
      label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
      description: 'ByteDance 豆包 Seedream 5.0 Pro，最高 2K；參考圖會轉為 PNG / JPEG 送出。',
    },
    'kie:grok-imagine-image-2-0': {
      label: 'Grok Imagine 2.0 (KIE)',
      description: 'KIE 提供的 xAI Grok Imagine 2.0；有參考圖時最多 5 張、prompt 上限 8,000 字元，沒有解像度選項。',
    },
    'kie:gpt-image-2': {
      label: 'GPT Image 2 (KIE)',
      description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。',
    },
    'kie:nano-banana-2': {
      label: 'Nano Banana 2 (KIE)',
      description: 'KIE 提供的 Gemini 3.1 Flash Image。',
      maskEditing: 'supported',
    },
  },
  scopes: {
    og: {},
    infocard: {},
    possession: {},
    batch: {},
    editor: {},
  },
};

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
  policy: POLICY,
  env: process.env,
  secretNames: { toapis: ['TOAPIS_API_KEY', 'TOAPI_API_KEY'] },
  convertReference,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const ogImages = imageClient.forScope('og');
export const infocardImages = imageClient.forScope('infocard');
export const possessionImages = imageClient.forScope('possession');
export const batchImages = imageClient.forScope('batch');
export const editorImages = imageClient.forScope('editor');
```

Notes:

- If the current file's `createImageClient()` call has other options than `app`, `models`, `env`, `secretNames`, `convertReference` and `googleHeaders`, keep them.
- Families without an override use the catalogue name, `price: null` (shown as "—") and `maskEditing: 'reference-only'`. Do not add entries for models the packages do not declare.
- `createImageClient()` throws at startup if an override names a family the installed packages do not declare. If that happens after a provider upgrade, remove the stale key; do not catch the error.

## Step 3: `server.ts`

1. Change the image imports to:

   ```ts
   import { handleImageRequest, imageErrorBody, type ImagePart } from "@hk01/pi-ai-extra-image-kit/server";
   import {
     DEFAULT_IMAGE_MODEL_ID,
     batchImages,
     editorImages,
     imageClient,
     infocardImages,
     ogImages,
     possessionImages,
   } from "./server/imageModels";
   ```

2. Replace the model list endpoint:

   ```ts
   // Image models for one route-owned scope (?scope=og | infocard | possession | batch | editor)
   app.get("/api/image-models", (req, res) => {
     const scope = typeof req.query.scope === "string" ? req.query.scope : "";
     try {
       res.json({ models: imageClient.forScope(scope).listModels() });
     } catch (error) {
       res.status(400).json(imageErrorBody(error));
     }
   });
   ```

3. In each image route, replace the second argument of `handleImageRequest()` (`imageClient`) with the route's scoped client from the Rules table: `ogImages`, `infocardImages`, `possessionImages`, `batchImages` or `editorImages`. Keep every other argument and the `finish` callbacks unchanged. After this, `imageClient` is used only by `/api/image-models`.
4. Replace the three body defaults `'gemini-nano-banana-2.1'` (`modelId` in `/api/infocard/generate-card` and `/api/batch-edit/process-image`, `imageModel` in `/api/possession/generate`) with `DEFAULT_IMAGE_MODEL_ID`.

## Step 4: browser

1. Pass the tool's scope to every `useImageModels()` call:

   | File | Call |
   | --- | --- |
   | `src/App.tsx` | `useImageModels('og')` |
   | `src/components/infocard/InfoCardExpert.tsx` | `useImageModels('infocard')` |
   | `src/components/possession/PossessionExpert.tsx` | `useImageModels('possession')` |
   | `src/components/batch/BatchExpert.tsx` | `useImageModels('batch')` |
   | `src/components/DeepEditor.tsx` | `useImageModels('editor')` |
   | `src/components/TokenHistory.tsx` | `useImageModels('og')` (labels for the OG history it shows) |

   Each scope has its own cache, so tools load independently.
2. Replace every default model ID `'gemini-nano-banana-2.1'` with `'google:gemini-nano-banana-2.1'`:
   - the local `DEFAULT_IMAGE_MODEL_ID` constants in `src/App.tsx`, `InfoCardExpert.tsx`, `PossessionExpert.tsx` and `BatchExpert.tsx`;
   - the `useState<BatchModelId>(…)` initial value in `BatchExpert.tsx` (use its `DEFAULT_IMAGE_MODEL_ID`);
   - the store defaults in `src/store.ts` and `src/lib/infocardStore.ts`, and `selectedImageModel` in `src/types/possession.ts`.

   Keep each `ImageModelSelector`'s `defaultModelId`: when restored state holds an old ID, the selector switches it to the default after the list loads, and the existing state saving stores the canonical ID.
3. `DeepEditor` keeps receiving `modelId` from the tool that opened it; the `/api/gemini/edit` route validates that ID against the `editor` scope.
4. `TokenHistory` keeps `findImageModel(models, id)?.label ?? id`. History saved before this migration shows its old ID; do not add a label table for old IDs.
5. Keep `ErrorPanel` in `src/main.tsx` and every existing `reportError()` call. Validation failures (`unsupported_model`, `reference_limit`, `prompt_too_long`, `resolution_unsupported`, `missing_key`, …) arrive as structured JSON before any provider call; `postImageRequest()` throws them as `ImageRequestError`, and the existing catch blocks must pass that error to `reportError()` unchanged.

## Step 5: verification

1. Run `npm install`, `npm run lint`, `npm run build`, then `npm start`. The server starts from `dist/server.mjs`, and the install log shows no `patch-google-models` step.
2. For each scope `og`, `infocard`, `possession`, `batch` and `editor`, `GET /api/image-models?scope=<scope>` returns these 11 IDs in this order:

   ```text
   google:gemini-nano-banana-2.1
   google:gemini-3.1-flash-image
   google:gemini-3-pro-image
   toapis:gemini-3.1-flash-image-preview
   toapis:gpt-image-2
   toapis:gpt-image-2.5-flare
   toapis:gpt-image-2.5-sunburst
   toapis:doubao-seedream-5-0-pro
   kie:grok-imagine-image-2-0
   kie:gpt-image-2
   kie:nano-banana-2
   ```

   `kie:gpt-image-2` and `kie:grok-imagine-image-2-0` are single entries; no selector label says "text to image" or "image to image". `google:gemini-nano-banana-2.1` reports `providerModel: "gemini-nano-banana-2.1"`.
3. `GET /api/image-models` without `scope`, and with `?scope=collage`, return HTTP 400 with an `error` field.
4. In each of the four tools, generate one 1K image with Nano Banana 2.1. Each server log line contains `model=google:gemini-nano-banana-2.1 google/gemini-nano-banana-2.1`. Then edit one result in DeepEditor and check the same log.
5. In Batch, run one text-only request with GPT Image 2 (KIE) and one with a base image. The logs show `kie/gpt-image-2-text-to-image` and `kie/gpt-image-2-image-to-image`.
6. With an invalid `GEMINI_API_KEY`, generate with Nano Banana 2.1. The ErrorPanel shows `google/gemini-nano-banana-2.1`, the error code and `App model: google:gemini-nano-banana-2.1`, and its report can be copied.
7. Select Grok Imagine 2.0 (KIE) with more than 5 reference images. The option is disabled with its reference limit and `ImageModelIssue` explains it; no image is dropped and no other model is called.
8. Reload with restored state that holds `nano-banana-2`. After the list loads the tool shows Nano Banana 2.1 and saves `google:gemini-nano-banana-2.1`.
9. Search the app. There is no `ImageModelOption`, no `models:` field passed to `createImageClient`, no handler that passes `imageClient` to `handleImageRequest`, no `useImageModels()` call without a scope, no `postinstall`, no `patch-google-models`, and no old default ID `'gemini-nano-banana-2.1'` without the `google:` prefix.
10. Report every file changed or deleted, and any step whose excerpt did not match the current code together with how you applied it.
