# Task: migrate the current open-graph-single image path to image-kit

You are editing the current Google AI Studio `open-graph-single` app: React + Vite client and ESM Express `server.ts`. Use the files that are present in this app now; do not apply an old patch mechanically.

The current code has a false Nano Banana 2.1 implementation:

```ts
if (appModelId === "gemini-nano-banana-2.1" || appModelId === "nano-banana-2.1") {
  return { provider: "google", model: "gemini-3.1-flash-image" };
}
```

This is incorrect. `gemini-nano-banana-2.1` must call the real provider model `gemini-nano-banana-2.1`. It must never fall back to Gemini 3.1 Flash Image.

## Preconditions

1. Do not begin package installation until this Google release exists and is anonymously downloadable:

   ```text
   https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.0/hk01-pi-ai-extra-google-0.3.0.tgz
   ```

   It is the release that contains the real Nano Banana 2.1 catalogue entry and its `v1` / `responseFormat.image` transport. If the asset is unavailable, stop and report that prerequisite. Do **not** substitute `gemini-3.1-flash-image`.
2. Export/download the app before editing. AI Studio has no Git; the export is the rollback point.
3. Keep the current ESM build and start scripts unchanged.

## Non-negotiable rules

1. **One request, one selected provider/model.** No model fallback, provider fallback, host fallback, billed retry, safety-retry, or silent reference-image removal.
2. **Keep every user-visible prompt rule.** `server/providers/kie.ts` and `server/providers/toapis.ts` currently contain prompt-construction rules that are still live. Before removing the provider wrappers, move the necessary prompt-only logic into an app-owned pure helper. Do not discard text or change its semantics just because its former HTTP wrapper is removed.
3. **Do not preserve obsolete network code.** After the prompt-only logic has been moved, delete old provider-specific network clients and branches that are no longer reachable. Do not leave duplicate provider calls behind.
4. **Server secrets only.** Read `GEMINI_API_KEY`, `KIE_API_KEY` and `TOAPIS_API_KEY` on the server only. Browser code must never read or receive provider keys.
5. **Keep all reference images.** Exceeding a model limit is a visible validation error; never use `.slice()`, a fallback model, or a filtered upload list to make a request fit.
6. **Do not enable Google Search grounding, image search grounding, thinking controls, or other Nano Banana 2.1 options.** This migration only supports normal text-and-image generation/editing. Search grounding needs attribution UI and is out of scope.
7. **Do not invent package APIs.** Use only these published image-kit exports:
   - server: `createImageClient`, `handleImageRequest`, `imageErrorBody`, `imageErrorStatus`, `type ImageModelOption`, `type ImagePart` from `@hk01/pi-ai-extra-image-kit/server`;
   - browser: `postImageRequest`, `isAbort`, `ImageRequestError`, `reportError` from `@hk01/pi-ai-extra-image-kit/browser`;
   - React: `useImageModels`, `findImageModel`, `ImageModelSelector`, `ImageModelIssue`, `ErrorPanel` from `@hk01/pi-ai-extra-image-kit/react`.

## Step 1: dependencies

In `package.json`, replace the old Google release URL and add image-kit. Keep KIE and ToAPIs pinned to their existing 0.1.0 release assets. Use these exact entries:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.0/hk01-pi-ai-extra-google-0.3.0.tgz",
"@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.1.0/hk01-pi-ai-extra-image-kit-0.1.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
```

After all image paths are migrated, remove `@google/genai` and `OPENROUTER_API_KEY` only if a repository-wide search confirms neither is used by another remaining feature.

## Step 2: create `server/imageModels.ts`

Create this app-owned allowlist. It is the only place that decides which image models this app offers. Prices below are `null`: the existing approximate values are not verified provider prices and must not be copied into image-kit cost displays.

```ts
import { createImageClient, type ImageModelOption } from '@hk01/pi-ai-extra-image-kit/server';

export const DEFAULT_IMAGE_MODEL_ID = 'gemini-nano-banana-2.1';

const MODELS: readonly ImageModelOption[] = [
  {
    id: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1',
    description: 'Google Gemini Nano Banana 2.1，預設高速圖片生成及編輯模型。',
    provider: 'google',
    model: 'gemini-nano-banana-2.1',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    description: 'Google Gemini 3.1 Flash Image，前代高速模型。',
    provider: 'google',
    model: 'gemini-3.1-flash-image',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    description: 'Google Gemini 3 Pro Image，適合高要求圖片。',
    provider: 'google',
    model: 'gemini-3-pro-image',
    maskEditing: 'supported',
    price: null,
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Flare。',
    provider: 'toapis',
    model: 'gpt-image-2.5-flare',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。',
    provider: 'toapis',
    model: 'gpt-image-2.5-sunburst',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2 (ToAPIs)',
    description: 'ToAPIs 提供的 GPT Image 2。',
    provider: 'toapis',
    model: 'gpt-image-2',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'doubao-seedream-5-0-pro',
    label: 'Doubao Seedream 5.0 Pro (ToAPIs)',
    description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。',
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
    description: 'KIE 提供的 Grok Imagine 2.0。',
    provider: 'kie',
    model: 'grok-imagine-image-2-0/image-edit',
    textOnlyModel: 'grok-imagine-image-2-0/text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-gpt-image-2',
    label: 'GPT Image 2 (KIE)',
    description: 'KIE 提供的 GPT Image 2。',
    provider: 'kie',
    model: 'gpt-image-2-image-to-image',
    textOnlyModel: 'gpt-image-2-text-to-image',
    maskEditing: 'reference-only',
    price: null,
  },
  {
    id: 'kie-nano-banana-2',
    label: 'Nano Banana 2 (KIE)',
    description: 'KIE 提供的 Nano Banana 2。',
    provider: 'kie',
    model: 'nano-banana-2',
    maskEditing: 'supported',
    price: null,
  },
];

export const imageClient = createImageClient({
  app: 'open-graph-single',
  models: MODELS,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});
```

Important:

- The canonical existing UI/state ID is `gemini-nano-banana-2.1`; keep that exact ID and map it to the same provider operation `gemini-nano-banana-2.1`.
- Do **not** add `nano-banana-2.1 -> gemini-3.1-flash-image` as an alias or fallback.
- Do not include disabled Wokey, OpenRouter, or Qwen entries. They are not supported by image-kit in this migration.

## Step 3: preserve prompt logic without preserving old provider clients

The existing `server/providers/kie.ts` and `server/providers/toapis.ts` are not merely HTTP clients: they contain prompt rules that current KIE/ToAPIs requests still use. Do this before deleting either file:

1. Extract their live prompt-construction logic into app-owned pure helpers, for example `server/imagePrompts.ts`.
2. Keep prompt text and image ordering exactly as the current path uses them. The helper may decide which current prompt profile to use from `imageClient.findModel(appModelId)?.provider`; it must not call a provider, read a secret, retry, or select a fallback model.
3. Keep the current direct Google prompt builder as the Google profile. Keep the current KIE and ToAPIs prompt builders as their respective profiles where they still differ. The migration must not silently replace their behavior with a shorter generic prompt.
4. Return Gemini-style `ImagePart[]`: text labels and `{ inlineData: { data, mimeType } }` values in the same order the prompt explains. The image-kit server will create `[Reference image N]` markers and validate all references.

The existing server `getInlineData()` helper may remain as the app-specific remote/data-URL normalizer. Its return shape already fits `ImagePart`; do not move remote-image fetching to the browser.

## Step 4: replace the image routes in `server.ts`

1. Remove imports of `server/providers/openrouter`, `server/providers/toapis`, `server/providers/kie`, and the old `server/providers/imageClient`.
2. Import:

   ```ts
   import {
     handleImageRequest,
     imageErrorBody,
     imageErrorStatus,
     type ImagePart,
   } from '@hk01/pi-ai-extra-image-kit/server';
   import { imageClient } from './server/imageModels';
   import { buildEditParts, buildGenerationParts } from './server/imagePrompts';
   ```

   Adapt the helper names to the actual extraction, but keep the server/provider boundary above.
3. Add one endpoint:

   ```ts
   app.get('/api/image-models', (_req, res) => {
     res.json({ models: imageClient.listModels() });
   });
   ```

4. Delete `createResponseSender`, its manual 8-second ping timer, and both route-local `AbortController`s. `handleImageRequest()` provides NDJSON `start`, 10-second `ping`, `complete` / `error`, and aborts provider polling when the browser disconnects.
5. In `/api/gemini/generate`, retain all existing body validation and prompt inputs. Delete the `isToapisModel`, `isKieModel`, and `isOpenRouterModel` branches. Construct the same app-owned `ImagePart[]` through the extracted prompt helper, then call exactly one image-kit request:

   ```ts
   await handleImageRequest(
     res,
     imageClient,
     {
       appModelId: safeModelId,
       parts,
       aspectRatio: ratio,
       resolution: imageQuality === '2K' ? '2K' : '1K',
     },
     async (image) => ({ imageUrl: image.dataUrl }),
   );
   ```

6. In `/api/gemini/edit`, preserve the current edit prompt and original-image input. Call image-kit with exactly one base-image part and `keepInputAspect: true`:

   ```ts
   await handleImageRequest(
     res,
     imageClient,
     {
       appModelId: safeModelId,
       parts,
       aspectRatio: ratio,
       keepInputAspect: true,
       resolution: imageQuality === '2K' ? '2K' : '1K',
     },
     async (image) => ({ imageUrl: image.dataUrl }),
   );
   ```

7. Route-level catches only answer before streaming begins:

   ```ts
   } catch (error) {
     if (!res.headersSent) {
       res.status(imageErrorStatus(error)).json(imageErrorBody(error));
     }
   }
   ```

Do not retain a direct `generateGoogleImage`, `generateKieImage`, `generateToapisImage`, or OpenRouter call in `server.ts`.

## Step 5: browser request reader and dynamic model UI

### `src/lib/gemini.ts`

Keep `processFinalImage()` and the exported `generateOgImage()` / `editOgImage()` call signatures used by the UI, but replace the hand-written NDJSON parser, local `ImageRequestError`, and local error-report formatter with image-kit browser helpers.

- Import `postImageRequest`, `isAbort`, and `ImageRequestError` from `@hk01/pi-ai-extra-image-kit/browser`.
- Make one `postImageRequest()` per generation/edit request. It already sends the NDJSON `Accept` header, parses structured JSON validation errors and streamed errors, and never retries.
- Use `result.imageUrl`, then retain `processFinalImage()` unchanged.
- If `isAbort(error, signal)` is true, preserve the app's current silent `USER_CANCELLED` behavior. For every other error, rethrow the original structured error.
- Delete the old manual `readStreamOrJsonResponse`, locally duplicated `ImageRequestError`, local `ImageErrorDetails`, and `formatErrorReport` only after their callers use image-kit equivalents.

### `src/App.tsx` and `src/components/DeepEditor.tsx`

Replace static model configuration and hand-written image errors with image-kit React/browser APIs.

- Load models through `useImageModels()`; the server allowlist is the selector source of truth.
- Use `DEFAULT_IMAGE_MODEL_ID` (`gemini-nano-banana-2.1`) as the initial/fallback selected ID after the list has loaded.
- Use `ImageModelSelector` grouped by provider. For the main generation screen, pass the exact number of references that will be sent: template + every source image + optional logo. For DeepEditor, pass one base-image reference. Pass the selected resolution in `needs`.
- Display `ImageModelIssue` by the relevant Generate/Edit control and do not submit when the selected model cannot satisfy the current reference count, resolution, or server key requirement.
- Use `findImageModel()` for selected-model labels; do not retain a second static server-routing registry in `src/models.config.ts`.
- Mount one `ErrorPanel` outside views/modals that can unmount.
- On non-cancellation errors, call `reportError(error, operation, context)` with useful context such as selected model and ratio. Keep cancellation silent. Do not replace a structured provider error with a generic toast or a timed auto-dismiss error.
- Preserve success toasts and all existing non-image UI behavior.

After all browser consumers are changed, remove now-unused `MODELS_CONFIG`, `ACTIVE_MODELS`, `isToapisModel`, `isKieModel`, `isOpenRouterModel`, `isWokeyModel`, and provider-routing types from `src/models.config.ts`. If a history component still needs a label for an old persisted ID, give it a display-only fallback that does not select a provider or model. Do not retain routing compatibility aliases.

## Step 6: delete only dead code

After TypeScript confirms there are no imports, delete these old network modules:

```text
server/providers/imageClient.ts
server/providers/kie.ts
server/providers/toapis.ts
server/providers/openrouter.ts
```

Also remove the OpenRouter entry and helper branches from the old static model configuration before deleting that configuration. Remove Wokey-only and Qwen-only dead code if no remaining non-image feature references it.

Do not delete `getInlineData`, canvas post-processing, image proxy handling, Firebase/history, or app-owned prompt helpers: they remain reachable after the provider transport is replaced.

## Step 7: verification

Before finishing, perform all of the following:

1. Run `npm run lint` and `npm run build`; do not alter `build` or `start`. Run `npm start` and verify the server starts as `dist/server.mjs`.
2. `GET /api/image-models` returns 11 app models, grouped as Google 3, ToAPIs 5, KIE 3. With the Google 0.3.0 release installed, it reports `gemini-nano-banana-2.1` as the provider model for the default app ID; it must not report `gemini-3.1-flash-image`.
3. With a valid key, run one 1K Nano Banana 2.1 generation. Verify the server log uses `model=gemini-nano-banana-2.1`.
4. With an invalid `GEMINI_API_KEY`, select Nano Banana 2.1. The ErrorPanel includes `google / gemini-nano-banana-2.1`, the error code, HTTP status when known, and a copyable report.
5. With template + 5 sources + logo, select a model below seven references. The selector or server reports a `reference_limit`; no image is removed and no alternate provider/model is attempted.
6. Cancel a long request. The browser stays silent for cancellation and the server stops provider polling. A request already submitted may still be billed; do not retry it.
7. Search the app after migration. There must be no reachable direct provider call, no `resolveTarget`, no `gemini-nano-banana-2.1 -> gemini-3.1-flash-image` mapping, no OpenRouter route branch, no legacy `createResponseSender`, and no deleted provider-module imports.
8. Report the exact files created, changed, and deleted, plus any prompt rule that had to be moved into `server/imagePrompts.ts` to preserve current behavior.
