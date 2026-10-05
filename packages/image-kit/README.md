# @hk01/pi-ai-extra-image-kit

Image client for Google AI Studio apps (React + Vite client, Express server) on top of the provider packages `@hk01/pi-ai-extra-google`, `-kie` and `-toapis`. An app lists the image models it offers; the kit validates each request against the package catalogues, calls exactly the selected provider and model, streams the result to the browser, and gives the browser a model selector and an error panel.

| Import | Runs in | Contents |
| --- | --- | --- |
| `@hk01/pi-ai-extra-image-kit` | server and browser | Types, `modelIssue()` and the other checks, `estimateImageCostUsd()`, `ratioValue()` |
| `@hk01/pi-ai-extra-image-kit/server` | **server only** | `createImageClient()`, `handleImageRequest()`, `streamImageResponse()`, error helpers |
| `@hk01/pi-ai-extra-image-kit/browser` | browser | `postImageRequest()` (reads the NDJSON stream), `fetchImageModels()`, `reportError()` |
| `@hk01/pi-ai-extra-image-kit/react` | browser (React) | `useImageModels()`, `ImageModelSelector`, `ImageModelIssue`, `ErrorPanel` |

Every entry is CommonJS and ESM. Only `/server` imports the provider packages, so browser bundles stay free of provider code and keys.

## Install

The provider packages and React are peer dependencies. Install the pinned release assets next to each other:

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.2.0/hk01-pi-ai-extra-google-0.2.0.tgz",
"@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.1.0/hk01-pi-ai-extra-image-kit-0.1.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz"
```

Peer ranges: Google `>=0.2.0` (temperature and system instruction catalogue fields), KIE and ToAPIs `>=0.1.0`, React `>=18` (optional, only for `/react`).

## Guarantees

- One request, one provider, one model: no provider or model fallback, and a billed request is never re-sent.
- Reference images are never dropped. A request is rejected before any provider call (HTTP 400 / 503, nothing billed) when the model id is unknown, the provider key is missing, temperature is not accepted or out of range, there are too many or too few reference images, the prompt is longer than the model allows, or 4K is asked of a model that does not list it.
- Aspect ratio: the model's own ratio when it has it, otherwise the nearest one it accepts (KIE GPT Image 2's 2K / 4K exceptions included). Edits can keep the input image's aspect (Google: omitted, KIE: `auto`, others: nearest to the input).
- Resolution: 4K only for models that list it; 1K / 2K are left out for models without a resolution option (Grok), and the app resizes.
- Reference format and size are read from the bytes, as the packages do. An app can pass a `convertReference` function (for example with sharp) for images the model cannot take; without one they are rejected.
- Long tasks stream NDJSON (`start`, a `ping` every 10 s, then `complete` or `error`), so 60-second proxy idle timeouts do not cut them. A client disconnect aborts provider polling (a submitted task is still billed).
- Errors keep provider, model, code, HTTP status and task id. `ErrorPanel` shows them and copies a plain-text report.
- One `[usage] app=<app> …` log line per request; ToAPIs requests carry `client_business_id = <app>:<uuid>`.

## Server

```ts
import { createImageClient, handleImageRequest, type ImageModelOption, type ImagePart } from '@hk01/pi-ai-extra-image-kit/server';

const MODELS: readonly ImageModelOption[] = [
  {
    id: 'nano-banana-2', // stored by the UI
    label: 'Nano Banana 2',
    description: '…',
    provider: 'google',
    model: 'gemini-3.1-flash-image', // catalogue model id
    maskEditing: 'supported',
    price: { perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, inputPerMillionTokensUsd: 0.5 },
  },
  // Models with a separate text-to-image operation set `textOnlyModel` (KIE GPT Image 2, Grok).
];

export const imageClient = createImageClient({
  app: 'infocard', // usage logs and ToAPIs client_business_id
  env: process.env, // secrets are read from here at call time; the kit never reads the environment itself
  models: MODELS, // the selector groups providers in this order
  secretNames: { toapis: ['TOAPIS_API_KEY', 'TOAPI_API_KEY'] }, // optional; defaults GEMINI_API_KEY/API_KEY, KIE_API_KEY, TOAPIS_API_KEY
  convertReference, // optional
  googleHeaders: { 'User-Agent': 'aistudio-build' }, // optional
});

app.get('/api/image-models', (_req, res) => res.json({ models: imageClient.listModels() }));

app.post('/api/generate', async (req, res) => {
  const parts: ImagePart[] = [{ text: 'TEMPLATE:' }, { inlineData: { mimeType, data } }, { text: prompt }];
  await handleImageRequest(res, imageClient, { appModelId: req.body.modelId, parts, aspectRatio: '4:5', resolution: '2K' }, async (image) => ({
    imageUrl: await resize(image.dataUrl),
  }));
});
```

Gemini-style parts become one prompt with `[Reference image N]` markers and the images in order. Rules passed as `systemInstruction` go to Google as a system instruction and are placed before the prompt for KIE and ToAPIs.

## Browser

```tsx
import { postImageRequest, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
import { ErrorPanel, ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';

const { models, loading, failed, reload } = useImageModels();
const needs = { referenceCount: 3, resolution: '2K' as const };

<ImageModelSelector models={models} loading={loading} failed={failed} onReload={reload}
  value={modelId} onChange={setModelId} defaultModelId="nano-banana-2" needs={needs} className="…" />
<ImageModelIssue model={findImageModel(models, modelId)} needs={needs} />

try {
  const { imageUrl } = await postImageRequest('/api/generate', body, abortController.signal);
} catch (error) {
  reportError(error, '圖片生成');
}

// Once, at the app root:
<ErrorPanel />
```

The selector and the hint take the app's own class names. The error panel uses inline styles, because Tailwind does not scan packages in `node_modules`.

## Development

`pnpm run check` type-checks against the provider sources. `pnpm run test` builds the provider packages and runs the tests against their built entries with the real catalogues and a fake `fetch`. The React components are type-checked only.
