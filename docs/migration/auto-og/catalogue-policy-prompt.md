# Task: move Auto OG to image-kit 0.2 and its catalogue policy

You are editing the current Google AI Studio Auto OG app (OG 拼貼大師): React + Vite client and ESM Express `server.ts`. Use the files present in the app now; apply each step by intent where the code has drifted from the excerpts below.

Auto OG still carries app-local copies of the image client: a hand-written model registry (`server/imageModels.ts`), provider calls (`server/imageClient.ts`), an NDJSON writer (`server/ndjson.ts`) and browser copies of the reader, selector, hook and error panel. Two parts are unsafe:

- `server/imageModels.ts` copies Google's Nano Banana 2.1 catalogue entry (`GOOGLE_2_1_MODEL_INFO`, `ALL_GOOGLE_IMAGE_MODELS`) and accepts the alias `nano-banana-2.1`;
- `server/imageClient.ts` sends Nano Banana 2.1 through `generateGoogleDirectImage()`, a direct `fetch` to Google's `v1beta` endpoint, because the installed Google package (0.2.0) does not know the model.

This migration replaces all of these with `@hk01/pi-ai-extra-image-kit` 0.2 and Google 0.3.2, which owns Nano Banana 2.1. image-kit 0.2 offers every model **family** declared by the installed Google, ToAPIs and KIE packages, minus the families a scope excludes, so a later provider package upgrade adds new models without editing this app. A family is one selector entry; image-kit chooses the provider's text-to-image or image-to-image operation from whether the request has reference images.

## Preconditions

1. All four release assets in Step 1 must exist and download anonymously. If any is missing, stop and report it; do not substitute another version.
2. Export/download the app before editing. AI Studio has no Git; the export is the rollback point.
3. Keep the `build` and `start` scripts unchanged (ESM, `dist/server.mjs`).

## Rules

1. **One request, one selected provider family.** No model, provider, host or billed retry fallback; no silent reference-image removal.
2. **Canonical model IDs.** UI state, request bodies, saved drafts and logs use `provider:familyId` (for example `google:gemini-nano-banana-2.1`, `kie:gpt-image-2`). Old IDs are not routed: a stored old ID resets to the default once the model list loads. Add no alias that maps an old ID to a model.
3. **Route-owned scopes.** `/api/generate-collage` always uses scope `collage`; `/api/edit-image` always uses scope `edit`. Both exclude Grok Imagine 2.0 (Step 2). A request body never selects a scope. The browser asks `GET /api/image-models?scope=…` for the list matching the route it will call.
4. **Provider transport stays in the packages.** After this migration the app contains no provider endpoint URL, request payload, catalogue entry or model-ID mapping for image generation.
5. **Prompts are unchanged.** Every collage and edit prompt, system instruction and image order stays as it is. Only the code that selects the Nano Banana 2 wording changes (Step 3).
6. **Keep everything else.** The text routes (`/api/fetch-article`, `/api/generate-viral-titles`, `/api/extract-page-images`), `@google/genai`, post-processing, usage tracking, history, drafts and Firebase stay as they are. Keep `@google/genai` in `package.json`; only the text routes use it.
7. **Use only these image-kit exports:**
   - server: `createImageClient`, `handleImageRequest`, `imageErrorBody`, `imageErrorStatus`, `type CanonicalModelKey`, `type CataloguePolicy`, `type ImagePart` from `@hk01/pi-ai-extra-image-kit/server`;
   - root (browser-safe): `estimateImageCostUsd`, `estimateInputTokens`, `modelIssue`, `remainingReferenceCapacity`, `temperatureFor`, `TEMPERATURE_SUPPORT_NOTE`, `MASK_REFERENCE_ONLY_NOTE`, `type ImageModelView` from `@hk01/pi-ai-extra-image-kit`;
   - browser: `postImageRequest`, `ImageRequestError`, `reportError`, `type ErrorEntry` from `@hk01/pi-ai-extra-image-kit/browser`;
   - React: `useImageModels`, `findImageModel`, `ImageModelSelector`, `ImageModelIssue`, `ErrorPanel` from `@hk01/pi-ai-extra-image-kit/react`.

   Never import `@hk01/pi-ai-extra-image-kit/server` or a provider package from browser code.

## Step 1: dependencies

In `package.json`, replace the three `@hk01/pi-ai-extra-*` entries with exactly these four. image-kit 0.2.0 requires these provider versions or newer:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.2/hk01-pi-ai-extra-google-0.3.2.tgz",
"@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.2.0/hk01-pi-ai-extra-kie-0.2.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.2.0/hk01-pi-ai-extra-toapis-0.2.0.tgz"
```

Change nothing else in `package.json`.

## Step 2: replace `server/imageModels.ts`

Replace the whole file with the following. The labels, descriptions, prices and mask-editing values are Auto OG's current ones, keyed by canonical ID. The prompt profile map keeps the current `promptProfile` assignments.

```ts
import { createImageClient, type CanonicalModelKey, type CataloguePolicy } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * Auto OG's catalogue policy and route-owned image clients. Every image model family in the
 * installed Google, ToAPIs and KIE packages is offered unless a scope excludes it, so a provider
 * package upgrade adds its new families. Limits and capabilities come from the catalogues; this
 * file only holds Auto OG's labels, verified prices, mask-editing guidance and prompt profiles.
 */

/**
 * Collage prompts are 11.6k–16.4k characters, over Grok Imagine 2.0 edit's 8,000-character limit.
 * The editor uses the collage model selection, so edit excludes it too.
 */
const GROK_IMAGINE: CanonicalModelKey = 'kie:grok-imagine-image-2-0';

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
    'kie:gpt-image-2': { label: 'GPT Image 2 (KIE)', description: 'KIE 提供的 GPT Image 2；有參考圖時使用 image-to-image。' },
    'kie:nano-banana-2': { label: 'Nano Banana 2 (KIE)', description: 'KIE 提供的 Gemini 3.1 Flash Image。', maskEditing: 'supported' },
  },
  scopes: {
    collage: { exclude: [GROK_IMAGINE] },
    edit: { exclude: [GROK_IMAGINE] },
  },
};

export const imageClient = createImageClient({
  app: 'auto-og',
  policy: POLICY,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const collageImages = imageClient.forScope('collage');
export const editImages = imageClient.forScope('edit');

/** Selects prompt wording tuned for a model family (see the collage route). */
export type PromptProfile = 'nano-banana-2' | 'default';

/** Families that get the Nano Banana 2 wording. Any other family, including a new one, uses `default`. */
const NANO_BANANA_2_FAMILIES: ReadonlySet<string> = new Set([
  'google:gemini-nano-banana-2.1',
  'google:gemini-3.1-flash-image',
  'kie:nano-banana-2',
  'toapis:gemini-3.1-flash-image-preview',
]);

export function promptProfileFor(appModelId: string): PromptProfile {
  return NANO_BANANA_2_FAMILIES.has(appModelId) ? 'nano-banana-2' : 'default';
}
```

Notes:

- image-kit's default secret names are the ones Auto OG uses now (`GEMINI_API_KEY` then `API_KEY`, `KIE_API_KEY`, `TOAPIS_API_KEY`), and its provider labels are the same (`Google Gemini`, `KIE 提供`, `ToAPIs 提供`).
- Families without an override use the catalogue name, `price: null` (shown as "—"), `maskEditing: 'reference-only'` and the `default` prompt profile. Do not add entries for models the packages do not declare.
- `createImageClient()` throws at startup if an override or exclusion names a family the installed packages do not declare. If that happens after a provider upgrade, remove the stale key; do not catch the error.

## Step 3: `server.ts`

1. Replace the four imports from `./server/imageClient`, `./server/imageModels`, `./server/ndjson` and `./shared/imageOutput` with:

   ```ts
   import {
     handleImageRequest,
     imageErrorBody,
     imageErrorStatus,
     type ImagePart,
   } from "@hk01/pi-ai-extra-image-kit/server";
   import { collageImages, editImages, imageClient, promptProfileFor } from "./server/imageModels";
   import { OUTPUT_SPECS, outputSpec } from "./shared/imageOutput";
   ```

2. Replace the model list endpoint:

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
   ```

3. Delete the local `imageErrorBody()` function (image-kit's has the same `{ error, details }` shape) and change `sendImageError()` to:

   ```ts
   /** Errors found before streaming starts as JSON; validation errors keep their HTTP status. */
   function sendImageError(res: express.Response, route: string, error: unknown) {
     console.error(`[PROXY ERROR] ${route} failed:`, error);
     if (res.headersSent) return;
     res.status(imageErrorStatus(error)).json(imageErrorBody(error));
   }
   ```

4. In `/api/generate-collage`:
   - Replace `imageModelView(String(selectedModel ?? ""))?.promptProfile === "nano-banana-2"` with `promptProfileFor(String(selectedModel ?? "")) === "nano-banana-2"`.
   - Replace `imageModelView(String(selectedModel ?? ""))?.temperature` with `collageImages.findModel(String(selectedModel ?? ""))?.temperature`.
   - Replace the `prepareAppImage(…)` call and the `streamImageResponse(…)` line with:

     ```ts
     await handleImageRequest(
       res,
       collageImages,
       {
         appModelId: String(selectedModel ?? ""),
         parts,
         systemInstruction,
         aspectRatio: String(ratio),
         resolution: outputSpec(String(ratio)).resolution,
         temperature: effectiveTemperature,
       },
       async (image) => ({ imageUrl: image.dataUrl }),
     );
     ```

   Keep the `OUTPUT_SPECS` ratio check, every prompt string and the temperature rule above it. image-kit sends the model's exact ratio when it has one, otherwise the nearest; `300x250` and `320x250` are read as width × height.
5. In `/api/edit-image`, replace the `prepareAppImage(…)` call and the `streamImageResponse(…)` line with:

   ```ts
   await handleImageRequest(
     res,
     editImages,
     {
       appModelId,
       parts,
       systemInstruction,
       // The input image's "width:height"; used when the model cannot keep the input aspect.
       aspectRatio: typeof sourceAspect === "string" ? sourceAspect : undefined,
       keepInputAspect: true,
       // Edits have always requested 1K: a pixel "width:height" is not an output preset.
       resolution: "1K",
       // Explicit edit temperatures (logo replacement uses 0.5) are validated; otherwise 0.7 where supported.
       temperature: temperature ?? (editImages.findModel(appModelId)?.temperature ? EDIT_TEMPERATURE : undefined),
     },
     async (image) => ({ imageUrl: image.dataUrl }),
   );
   ```

   Keep the base → mask → extra image order and all edit prompt text.
6. `handleImageRequest()` answers validation errors (unknown or excluded model, missing key, reference limit, prompt too long, unsupported temperature or resolution) with JSON and their HTTP status before any provider call, then streams NDJSON `start`, a `ping` every 10 seconds, and `complete` (`imageUrl`) or `error` (`error`, `details`). The routes' existing `catch` blocks still call `sendImageError()` for failures before that point.
7. Delete `server/imageClient.ts` and `server/ndjson.ts` once nothing imports them.

## Step 4: app-owned browser modules

1. Replace the whole of `shared/imageModels.ts` with:

   ```ts
   import { estimateImageCostUsd, type ImageModelView } from '@hk01/pi-ai-extra-image-kit';
   import { outputSpec } from './imageOutput';

   /**
    * Auto OG's own image-model constants and cost estimate. Model views, limits and the other
    * helpers come from @hk01/pi-ai-extra-image-kit. Safe in the browser bundle.
    */

   export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';
   export const USD_TO_HKD = 7.8;

   /**
    * Estimated USD for one request per entry of `ratios`, or null when the model's price is unknown.
    * Each output image is its own request, so input tokens are counted once per image.
    */
   export function estimateCostUsd(
     model: ImageModelView | undefined,
     input: { inputImages: number; promptChars: number; ratios: readonly string[] },
   ): number | null {
     if (!model?.price) return null;
     let total = 0;
     for (const ratio of input.ratios) {
       const cost = estimateImageCostUsd(model, {
         resolution: outputSpec(ratio).resolution,
         inputImages: input.inputImages,
         promptChars: input.promptChars,
       });
       if (cost === null) return null;
       total += cost;
     }
     return total;
   }
   ```

2. Replace the whole of `services/errorReporter.ts` with the following. It keeps Auto OG's operation names, so its callers need no change, and sends every error to image-kit's `ErrorPanel`:

   ```ts
   import { reportError as reportToErrorPanel, type ErrorEntry } from '@hk01/pi-ai-extra-image-kit/browser';

   /** Auto OG's operation names for errors shown by image-kit's ErrorPanel. */
   export type ErrorOperation = 'collage' | 'edit' | 'titles' | 'article' | 'page-images';

   const OPERATION_LABELS: Record<ErrorOperation, string> = {
     collage: '拼貼生成',
     edit: '圖片編輯',
     titles: '標題生成',
     article: '讀取文章',
     'page-images': '擷取網頁圖片',
   };

   export function reportError(
     error: unknown,
     operation: ErrorOperation,
     context: Record<string, string | number | undefined> = {},
   ): ErrorEntry {
     return reportToErrorPanel(error, OPERATION_LABELS[operation], context);
   }
   ```

   image-kit's `useImageModels()` reports model-list failures itself (`載入圖片模型清單`), so the old `'image-models'` operation is gone.
3. `services/geminiService.ts`: import `postImageRequest` from `@hk01/pi-ai-extra-image-kit/browser`. It now resolves to `{ imageUrl, … }`, so in `generateCollage()` and `editImage()` write `const { imageUrl } = await postImageRequest(…)` and use `imageUrl` wherever `rawImageBase64` was used. The request bodies and post-processing stay the same.

## Step 5: components

Use this table for every changed import and call. TypeScript reports each call site the table changes, so run `npm run lint` until it is clean.

| Before (app-local) | After (image-kit) |
| --- | --- |
| `useImageModels()` from `./components/useImageModels` | `useImageModels('collage')` from `@hk01/pi-ai-extra-image-kit/react` |
| `findImageModel` from `./components/useImageModels` or `./useImageModels` | `findImageModel` from `@hk01/pi-ai-extra-image-kit/react` |
| `ImageModelSelector` / `ImageModelIssue` from `./components/ImageModelSelector` or `./ImageModelSelector` | same names from `@hk01/pi-ai-extra-image-kit/react` |
| `ErrorPanel` from `./components/ErrorPanel` | `ErrorPanel` from `@hk01/pi-ai-extra-image-kit/react` |
| `ImageRequestError` from `./services/imageApi` | `ImageRequestError` from `@hk01/pi-ai-extra-image-kit/browser` |
| `TEMPERATURE_SUPPORT_NOTE`, `MASK_REFERENCE_ONLY_NOTE`, `estimateInputTokens`, `remainingReferenceCapacity`, `temperatureFor`, `modelIssue`, `type ImageModelView` from `shared/imageModels` | same names from `@hk01/pi-ai-extra-image-kit` |
| `DEFAULT_IMAGE_MODEL_ID`, `USD_TO_HKD`, `estimateCostUsd` from `shared/imageModels` | unchanged (app-owned) |
| `reportError`, `type ErrorOperation` from `services/errorReporter` | unchanged (Step 4) |
| `modelIssue(model, count)` | `modelIssue(model, { referenceCount: count })` |
| `<ImageModelSelector … referenceCount={n} />` | `<ImageModelSelector … needs={{ referenceCount: n }} defaultModelId={DEFAULT_IMAGE_MODEL_ID} />` |
| `<ImageModelIssue model={m} referenceCount={n} className={c} />` | `<ImageModelIssue model={m} needs={{ referenceCount: n }} className={c} />` |
| `<ImageModelIssue model={m} referenceCount={n} />` (no className) | `<ImageModelIssue model={m} needs={{ referenceCount: n }} className="mt-2 text-xs font-semibold text-red-600" />` |

File-specific changes:

1. `App.tsx`: apply the table. Keep the effect that resets an unknown `selectedModel` to `DEFAULT_IMAGE_MODEL_ID`; with canonical IDs it also resets IDs restored from older drafts. Keep `<ErrorPanel />` where it is (outside `AppContent`). Stop passing `modelView` to `ImageEditor`.
2. `components/AutopilotStudio.tsx`: apply the table. Its `imageModels` prop is still the collage list from `App.tsx`, so it needs no `useImageModels()` call of its own.
3. `components/ImageEditor.tsx`: remove the `modelView` prop. The editor reads the list for the route it calls:

   ```tsx
   const { models: editModels } = useImageModels('edit');
   const modelView = findImageModel(editModels, selectedModel);
   ```

   Import both from `@hk01/pi-ai-extra-image-kit/react`, and `MASK_REFERENCE_ONLY_NOTE`, `temperatureFor`, `type ImageModelView` from `@hk01/pi-ai-extra-image-kit`. The existing `temperatureFor(modelView, 0.5)` and mask-note code then work unchanged. The `/api/edit-image` route validates `selectedModel` against the `edit` scope and returns a structured error, which the existing `reportError(e, 'edit', …)` shows in the `ErrorPanel`.
4. Delete these files once nothing imports them: `components/ErrorPanel.tsx`, `components/ImageModelSelector.tsx`, `components/useImageModels.ts`, `services/imageApi.ts`.

Keep `components/TemperatureControl.tsx`, `services/usageService.ts` and `shared/imageOutput.ts` unchanged.

## Step 6: verification

1. Run `npm install`, `npm run lint`, `npm run build`, then `npm start`. The server starts from `dist/server.mjs`.
2. `GET /api/image-models?scope=collage` and `?scope=edit` each return these 10 IDs in this order (Grok Imagine 2.0 is excluded):

   ```text
   google:gemini-nano-banana-2.1
   google:gemini-3.1-flash-image
   google:gemini-3-pro-image
   toapis:gemini-3.1-flash-image-preview
   toapis:gpt-image-2
   toapis:gpt-image-2.5-flare
   toapis:gpt-image-2.5-sunburst
   toapis:doubao-seedream-5-0-pro
   kie:gpt-image-2
   kie:nano-banana-2
   ```

   `kie:gpt-image-2` is one entry; no selector label says "text to image" or "image to image". `google:gemini-nano-banana-2.1` reports `providerModel: "gemini-nano-banana-2.1"`.
3. `GET /api/image-models` without `scope`, and with `?scope=batch`, return HTTP 400 with an `error` field.
4. Send the request body the UI sends for one manual collage to `POST /api/generate-collage`, with `selectedModel` changed to `kie:grok-imagine-image-2-0`. The response is HTTP 400 with `details.code: "unsupported_model"`, and no provider is called.
5. Generate one manual collage with Nano Banana 2.1. The server log contains `[usage] app=auto-og model=google:gemini-nano-banana-2.1 google/gemini-nano-banana-2.1`.
6. Generate one collage with GPT Image 2 (KIE). The log shows `kie/gpt-image-2-image-to-image`. The temperature control is disabled with the support note, and the cost estimate shows "—".
7. Edit a result with a mask using Nano Banana 2.1, then using GPT Image 2 (KIE). Both succeed; the KIE edit shows the mask reference-only note.
8. With an invalid `GEMINI_API_KEY`, generate with Nano Banana 2.1. The ErrorPanel shows `google/gemini-nano-banana-2.1`, the error code and `App model: google:gemini-nano-banana-2.1`, and its report can be copied. A failed title generation shows `操作: 標題生成` in the same panel.
9. Select ToAPIs GPT Image 2 (limit 6 references) with 7 template + source images. The option is disabled with its limit, the red hint appears, and Generate stays disabled; no image is dropped and no other model is called.
10. Restore a saved Autopilot draft whose `imageModel` is `nano-banana-2`. The selector switches to Nano Banana 2.1 after the list loads.
11. Search the app. None of these remain: `GOOGLE_2_1_MODEL_INFO`, `ALL_GOOGLE_IMAGE_MODELS`, `generateGoogleDirectImage`, `generativelanguage.googleapis.com`, `v1beta`, `findRegistryEntry`, `prepareAppImage`, `runAppImage`, `listImageModels`, `imageModelView`, `rawImageBase64`, `PROVIDER_ORDER`, an import of a deleted file, or an image model ID without its `provider:` prefix. `@google/genai` is imported only for the text routes.
12. Report every file created, changed or deleted, and any step whose excerpt did not match the current code together with how you applied it.
