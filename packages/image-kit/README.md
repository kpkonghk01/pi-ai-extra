# @hk01/pi-ai-extra-image-kit

Consumer-side image client for Google AI Studio apps. It derives selectable image **model families** from installed Google, KIE, and ToAPIs catalogues, applies the app's tool-scoped catalogue policy, validates one selected provider operation, streams its result, and provides browser selector/error UI.

| Import | Runs in | Contents |
| --- | --- | --- |
| `@hk01/pi-ai-extra-image-kit` | server and browser | Model-view types and pure checks such as `modelIssue()` and `ratioValue()` |
| `@hk01/pi-ai-extra-image-kit/server` | **server only** | Catalogue policy, `createImageClient()`, `handleImageRequest()`, NDJSON stream and errors |
| `@hk01/pi-ai-extra-image-kit/browser` | browser | `postImageRequest()`, scoped `fetchImageModels()`, `reportError()` |
| `@hk01/pi-ai-extra-image-kit/react` | browser | Scoped `useImageModels()`, selector, issue hint and `ErrorPanel` |

Only `/server` imports provider packages, so browser bundles never contain provider code or keys.

## Install

Install matching pinned release assets. A provider release adds its catalogue models; image-kit 0.2 derives non-excluded families automatically.

```json
"@hk01/pi-ai-extra-google": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.3.2/hk01-pi-ai-extra-google-0.3.2.tgz",
"@hk01/pi-ai-extra-image-kit": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz",
"@hk01/pi-ai-extra-kie": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.2.0/hk01-pi-ai-extra-kie-0.2.0.tgz",
"@hk01/pi-ai-extra-toapis": "https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.2.0/hk01-pi-ai-extra-toapis-0.2.0.tgz"
```

## Catalogue policy

Provider catalogues declare a family and operation role for every operation. A family is one user-visible model. A unified operation accepts text with or without reference images; paired text-to-image and image-to-image operations are selected internally from whether the request contains reference images.

The app does **not** maintain a complete allowlist. It owns a default policy and route-owned scopes:

- every family in the installed provider catalogues is included by default;
- generated app model IDs are canonical family keys such as `google:gemini-nano-banana-2.1` and `kie:gpt-image-2`;
- a scope's `exclude` list is additive to the default exclusion list and cannot re-include a default-excluded family;
- `overrides` are limited to app presentation data: label, description, verified price and mask-editing guidance;
- unknown families use catalogue name/notes, `price: null`, and `maskEditing: 'reference-only'`.
- a policy key that no installed catalogue declares (for example after a provider drops a family) makes `createImageClient()` throw at startup; remove the stale key.

The selector order is Google, ToAPIs, then KIE. Models within a provider keep provider catalogue declaration order.

### Migrating from 0.1

- `models: ImageModelOption[]` is replaced by `policy: CataloguePolicy`; `ImageModelOption` is no longer exported.
- `createImageClient()` returns a root client. Call `forScope(scope)` and pass the scoped client to `listModels()`, `findModel()`, `prepare()`, `run()` and `handleImageRequest()`.
- `GET /api/image-models` takes `?scope=`; use `fetchImageModels(scope, url?)` and `useImageModels(scope)`.
- Model IDs are canonical `provider:familyId`. Stored 0.1 IDs no longer match; reset them to the app default.

## Server

```ts
import {
  createImageClient,
  handleImageRequest,
  imageErrorBody,
  imageErrorStatus,
  type CataloguePolicy,
  type ImagePart,
} from '@hk01/pi-ai-extra-image-kit/server';

const policy: CataloguePolicy = {
  scopes: {
    collage: {
      exclude: ['kie:grok-imagine-image-2-0'],
    },
    edit: {
      exclude: ['kie:grok-imagine-image-2-0'],
    },
  },
};

const imageClient = createImageClient({
  app: 'auto-og',
  policy,
  env: process.env,
  googleHeaders: { 'User-Agent': 'aistudio-build' },
});

// The route owns its scope. Do not copy scope from a browser POST body.
const collageClient = imageClient.forScope('collage');

app.get('/api/image-models', (req, res) => {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
  try {
    res.json({ models: imageClient.forScope(scope).listModels() });
  } catch (error) {
    res.status(400).json(imageErrorBody(error));
  }
});

app.post('/api/generate', async (req, res) => {
  const parts: ImagePart[] = [{ text: 'TEMPLATE:' }, { inlineData: { mimeType, data } }, { text: prompt }];
  await handleImageRequest(
    res,
    collageClient,
    { appModelId: req.body.modelId, parts, aspectRatio: '4:5', resolution: '2K' },
    async (image) => ({ imageUrl: await resize(image.dataUrl) }),
  );
});
```

A browser may request a scope's model list, but a generation route remains pinned to its own scoped client. The browser cannot select a broader policy by changing its request body.

## Browser

```tsx
import { postImageRequest, reportError } from '@hk01/pi-ai-extra-image-kit/browser';
import { ErrorPanel, ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';

const { models, loading, failed, reload } = useImageModels('collage');
const needs = { referenceCount: 3, resolution: '2K' as const };
const defaultModelId = 'google:gemini-nano-banana-2.1';

<ImageModelSelector
  models={models}
  loading={loading}
  failed={failed}
  onReload={reload}
  value={modelId}
  onChange={setModelId}
  defaultModelId={defaultModelId}
  needs={needs}
  className="…"
/>
<ImageModelIssue model={findImageModel(models, modelId)} needs={needs} />

try {
  const { imageUrl } = await postImageRequest('/api/generate', body, abortController.signal);
} catch (error) {
  reportError(error, '圖片生成', { model: modelId });
}

// Mount once outside screens and modals that can unmount.
<ErrorPanel />
```

Known incompatibility is displayed before request submission through a disabled selector option and `ImageModelIssue`. If the server rejects a race or direct request, `postImageRequest()` receives structured JSON/NDJSON details and `reportError()` opens `ErrorPanel`; no provider call has been made for validation errors.

## Guarantees

- One request, one provider operation: no provider/model fallback and no billed retry.
- Reference images are never dropped. Dynamic reference count, prompt length, image format, resolution, temperature and key failures are rejected before a provider call and are visible to the user.
- Aspect ratio uses the selected operation's native ratio where possible, otherwise its nearest supported ratio. Edits can keep input aspect where supported.
- Long tasks stream NDJSON (`start`, 10-second `ping`, `complete` or `error`). Browser disconnect aborts polling, but a task already submitted can still be billed.
- Errors retain canonical app model family ID, actual provider operation, code, HTTP status and task ID.

## Development

`pnpm run check` type-checks source and migration artifacts. `pnpm --filter @hk01/pi-ai-extra-image-kit run test` builds provider dependencies and runs image-kit tests against built catalogue entries with fake fetch.
