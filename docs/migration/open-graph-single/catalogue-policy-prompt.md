# Task: move open-graph-single to the image-kit 0.2 catalogue policy

You are editing the current Google AI Studio `open-graph-single` app: React + Vite client and ESM Express `server.ts`. It already uses `@hk01/pi-ai-extra-image-kit` 0.1 with a static model list in `server/imageModels.ts`. Use the files present in the app now; apply each step by intent where the code has drifted from the excerpts below.

After this migration the app stops maintaining a model allowlist. image-kit 0.2 offers every model **family** declared by the installed Google, ToAPIs and KIE packages, so a later provider package upgrade adds its new models without editing this app. A family is one selector entry; image-kit chooses the provider's text-to-image or image-to-image operation from whether the request has reference images. The app keeps only its own labels, descriptions and mask-editing guidance as overrides.

## Preconditions

1. All four release assets below must exist and download anonymously. If any is missing, stop and report it; do not substitute another version.
2. Export/download the app before editing. AI Studio has no Git; the export is the rollback point.
3. Keep the `build` and `start` scripts unchanged (ESM, `dist/server.mjs`).

## Rules

1. **One request, one selected provider family.** No model, provider, host or billed retry fallback; no silent reference-image removal.
2. **Canonical model IDs.** UI state, request bodies, history records and logs use `provider:familyId` (for example `google:gemini-nano-banana-2.1`, `kie:gpt-image-2`). Old IDs are not routed: a stored old ID resets to the default once the model list loads. Add no alias that maps an old ID to a model.
3. **Route-owned scopes.** `/api/gemini/generate` always uses scope `generate`; `/api/gemini/edit` always uses scope `edit`. A request body never selects a scope. The browser asks `GET /api/image-models?scope=…` for the list matching the route it will call.
4. **Provider transport stays in the packages.** Add no provider endpoint, payload, model-ID mapping or catalogue metadata to the app.
5. **Prompt text is unchanged.** Only the lines that choose a prompt profile change (Step 3).
6. **Use only these image-kit exports:**
   - server: `createImageClient`, `handleImageRequest`, `imageErrorBody`, `imageErrorStatus`, `type CataloguePolicy`, `type ImagePart` from `@hk01/pi-ai-extra-image-kit/server`;
   - browser: `postImageRequest`, `isAbort`, `ImageRequestError`, `reportError` from `@hk01/pi-ai-extra-image-kit/browser`;
   - React: `useImageModels`, `findImageModel`, `ImageModelSelector`, `ImageModelIssue`, `ErrorPanel` from `@hk01/pi-ai-extra-image-kit/react`.

   `ImageModelOption` and the `models` config field no longer exist in 0.2.

## Step 1: dependencies

In `package.json`, replace the four `@hk01/pi-ai-extra-*` entries with exactly these. image-kit 0.2.0 requires these provider versions or newer, so update all four together:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.2/hk01-pi-ai-extra-google-0.3.2.tgz",
"@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.2.0/hk01-pi-ai-extra-kie-0.2.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.2.0/hk01-pi-ai-extra-toapis-0.2.0.tgz"
```

Change nothing else in `package.json`.

## Step 2: replace `server/imageModels.ts`

Replace the whole file with:

```ts
import { createImageClient, type CataloguePolicy } from '@hk01/pi-ai-extra-image-kit/server';

/**
 * open-graph-single's catalogue policy. Every image model family in the installed Google, ToAPIs
 * and KIE packages is offered, so a provider package upgrade adds its new families. Limits and
 * capabilities come from the catalogues; this file only holds the app's own labels.
 */

export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';

const POLICY: CataloguePolicy = {
  overrides: {
    'google:gemini-nano-banana-2.1': {
      label: 'Nano Banana 2.1',
      description: 'Google Gemini Nano Banana 2.1，預設高速圖片生成及編輯模型。',
      maskEditing: 'supported',
    },
    'google:gemini-3.1-flash-image': {
      label: 'Nano Banana 2',
      description: 'Google Gemini 3.1 Flash Image，前代高速模型。',
      maskEditing: 'supported',
    },
    'google:gemini-3-pro-image': {
      label: 'Nano Banana Pro',
      description: 'Google Gemini 3 Pro Image，適合高要求圖片。',
      maskEditing: 'supported',
    },
    'toapis:gemini-3.1-flash-image-preview': {
      label: 'Nano Banana 2 Preview (ToAPIs)',
      description: 'ToAPIs 提供的 Gemini 3.1 Flash Image Preview。',
      maskEditing: 'supported',
    },
    'toapis:gpt-image-2': { label: 'GPT Image 2 (ToAPIs)', description: 'ToAPIs 提供的 GPT Image 2。' },
    'toapis:gpt-image-2.5-flare': { label: 'GPT Image 2.5 Flare (ToAPIs)', description: 'ToAPIs 提供的 GPT Image 2.5 Flare。' },
    'toapis:gpt-image-2.5-sunburst': { label: 'GPT Image 2.5 Sunburst (ToAPIs)', description: 'ToAPIs 提供的 GPT Image 2.5 Sunburst。' },
    'toapis:doubao-seedream-5-0-pro': { label: 'Doubao Seedream 5.0 Pro (ToAPIs)', description: 'ToAPIs 提供的 ByteDance Seedream 5.0 Pro。' },
    'kie:grok-imagine-image-2-0': { label: 'Grok Imagine 2.0 (KIE)', description: 'KIE 提供的 Grok Imagine 2.0。' },
    'kie:gpt-image-2': { label: 'GPT Image 2 (KIE)', description: 'KIE 提供的 GPT Image 2。' },
    'kie:nano-banana-2': { label: 'Nano Banana 2 (KIE)', description: 'KIE 提供的 Nano Banana 2。', maskEditing: 'supported' },
  },
  scopes: {
    generate: {},
    edit: {},
  },
};

export const imageClient = createImageClient({
  app: 'open-graph-single',
  policy: POLICY,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

/** Route-owned clients. Each route uses its own scope; a request body never chooses one. */
export const generateImages = imageClient.forScope('generate');
export const editImages = imageClient.forScope('edit');
```

Notes:

- Families without an override use the catalogue name, `price: null` and `maskEditing: 'reference-only'`. Do not add entries for models the packages do not declare.
- `createImageClient()` throws at startup if an override or exclusion names a family the installed packages do not declare. If that happens after a provider upgrade, remove the stale key; do not catch the error.

## Step 3: `server/imagePrompts.ts`

The prompt builders stay; only the profile lookup changes, because the root client has no `findModel()` in 0.2 and model IDs now carry a provider prefix.

1. Replace `import { imageClient } from './imageModels';` with:

   ```ts
   import { editImages, generateImages } from './imageModels';

   /** The provider family part of a canonical `provider:familyId` model ID. */
   function familyIdOf(appModelId: string): string {
     return appModelId.slice(appModelId.indexOf(':') + 1);
   }
   ```

2. In `buildGenerationParts()`, use `generateImages.findModel(appModelId)` instead of `imageClient.findModel(appModelId)`. In `buildEditParts()`, use `editImages.findModel(appModelId)`.
3. In both builders, inside the `provider === 'toapis'` branch, replace each ID test as follows and keep the branch bodies unchanged:

   | Current condition | New condition |
   | --- | --- |
   | `appModelId === 'gpt-image-2.5-flare' \|\| appModelId.startsWith('gpt-image-2.5')` | `familyIdOf(appModelId).startsWith('gpt-image-2.5')` |
   | `appModelId === 'doubao-seedream-5-0-pro' \|\| appModelId.startsWith('doubao-')` | `familyIdOf(appModelId).startsWith('doubao-')` |

   A ToAPIs family added by a later package upgrade then uses the existing generic ToAPIs prompt, and a new KIE or Google family uses its provider's prompt.

## Step 4: `server.ts`

1. Change the image-kit and model imports to:

   ```ts
   import {
     handleImageRequest,
     imageErrorBody,
     imageErrorStatus,
   } from "@hk01/pi-ai-extra-image-kit/server";
   import { DEFAULT_IMAGE_MODEL_ID, editImages, generateImages, imageClient } from "./server/imageModels";
   ```

2. Replace the model list endpoint:

   ```ts
   // Image models for one route-owned scope (?scope=generate | edit)
   app.get("/api/image-models", (req, res) => {
     const scope = typeof req.query.scope === "string" ? req.query.scope : "";
     try {
       res.json({ models: imageClient.forScope(scope).listModels() });
     } catch (error) {
       res.status(400).json(imageErrorBody(error));
     }
   });
   ```

3. In `/api/gemini/generate`, pass `generateImages` as the second argument of `handleImageRequest()`. In `/api/gemini/edit`, pass `editImages`. Keep every other argument, the body validation and the route-level catch blocks as they are.
4. `DEFAULT_IMAGE_MODEL_ID` now has the canonical value, so the existing `modelId = DEFAULT_IMAGE_MODEL_ID` defaults need no other change.

## Step 5: browser

1. `src/App.tsx`:
   - set the local `DEFAULT_IMAGE_MODEL_ID` to `'google:gemini-nano-banana-2.1'`;
   - call `useImageModels('generate')`;
   - replace both `configData.selectedModel ?? 'nano-banana-2'` with `configData.selectedModel ?? DEFAULT_IMAGE_MODEL_ID`.

   Keep `ImageModelSelector`'s `defaultModelId={DEFAULT_IMAGE_MODEL_ID}`: when a stored `selectedModel` is an old ID, the selector switches it to the default after the list loads, and the existing config save stores the canonical ID.
2. `src/store.ts`: set the default `selectedModel` to `'google:gemini-nano-banana-2.1'`.
3. `src/components/DeepEditor.tsx`: call `useImageModels('edit')`. It keeps receiving `modelId` from the generate screen; the edit route validates that ID against its own scope.
4. `src/components/TokenHistory.tsx`: show `findImageModel(models, item.model)?.label ?? getModelLabel(item.model)`, with `const { models } = useImageModels('generate');` and the imports from `@hk01/pi-ai-extra-image-kit/react`. Keep `src/models.config.ts` unchanged: its labels are display-only for history records saved under old IDs.
5. `src/lib/pricing.ts`: `calculateCost()` runs for new generations, which now send canonical IDs. Replace only the ID literals, using this table, and leave the prices and the other branches unchanged:

   | Old ID in `calculateCost()` | Canonical ID |
   | --- | --- |
   | `gpt-image-2.5-flare` | `toapis:gpt-image-2.5-flare` |
   | `gpt-image-2.5-sunburst` | `toapis:gpt-image-2.5-sunburst` |
   | `gemini-nano-banana-2.1`, `nano-banana-2.1` | `google:gemini-nano-banana-2.1` (one test) |
   | `nano-banana-2` | `google:gemini-3.1-flash-image` |
   | `nano-banana-pro` | `google:gemini-3-pro-image` |

6. Keep `ErrorPanel` mounted once and keep every existing `reportError()` call. Validation failures (`unsupported_model`, `reference_limit`, `prompt_too_long`, `resolution_unsupported`, `missing_key`, …) arrive as structured JSON before any provider call; `postImageRequest()` throws them as `ImageRequestError`, and the existing catch blocks must pass that error to `reportError()` unchanged.

## Step 6: verification

1. Run `npm install`, `npm run lint`, `npm run build`, then `npm start`. The server starts from `dist/server.mjs`.
2. `GET /api/image-models?scope=generate` and `?scope=edit` each return these 11 IDs in this order:

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

   `kie:gpt-image-2` and `kie:grok-imagine-image-2-0` are single entries; no selector label says "text to image" or "image to image".
3. `GET /api/image-models` without `scope`, and with `?scope=batch`, return HTTP 400 with an `error` field.
4. Generate one 1K image with Nano Banana 2.1. The server log contains `model=google:gemini-nano-banana-2.1 google/gemini-nano-banana-2.1`.
5. Generate with GPT Image 2 (KIE) and a template. The log shows `kie/gpt-image-2-image-to-image`.
6. With an invalid `GEMINI_API_KEY`, generate with Nano Banana 2.1. The ErrorPanel shows `google/gemini-nano-banana-2.1`, the error code and `App model: google:gemini-nano-banana-2.1`, and its report can be copied.
7. Select Grok Imagine 2.0 (KIE) with template + 5 sources + logo. The option is disabled with its reference limit and `ImageModelIssue` explains it; no image is dropped and no other model is called.
8. Set the Firestore config `selectedModel` to `nano-banana-2` and reload. After the list loads the selector shows Nano Banana 2.1 and the saved config holds `google:gemini-nano-banana-2.1`.
9. Search the app. There is no `ImageModelOption`, no `models:` field passed to `createImageClient`, no `imageClient.findModel` or `imageClient.listModels`, and no handler that passes `imageClient` to `handleImageRequest`. Old model IDs remain only in the display-only labels of `src/models.config.ts`.
10. Report every file changed, and any step whose excerpt did not match the current code together with how you applied it.
