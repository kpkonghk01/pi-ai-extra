# opengraph2 migration, Part 2 of 3: model selection in the UI

Continue the same task. Part 1 is already applied, and its rules and edit format still apply.

This part makes the UI read its model list from the server. It covers:

- the model selector in the header;
- the reference-image limits;
- the temperature control;
- the mask-editing note in the deep editor;
- the model labels in the history preview and the cost log.

Image requests themselves change in Part 3.

Image models now have **canonical IDs** of the form `provider:familyId`, for example `google:gemini-nano-banana-2.1`, `toapis:gpt-image-2` or `kie:nano-banana-2`. The UI state, the request bodies and new history and log records all use these IDs. Old IDs such as `gemini-3-pro-image` are not mapped to anything: a saved old ID is reset to the default model.

## Step 1: `src/types.ts`

**Find** in `src/types.ts`:

```ts
  selectedModel: 'gemini-nano-banana-2.1' | 'gemini-3.1-flash-image' | 'gemini-3-pro-image';
```

**Replace with:**

```ts
  /** Canonical image model ID, `provider:familyId` (for example 'google:gemini-nano-banana-2.1'). */
  selectedModel: string;
```

Delete the hard-coded list of three Google models. The list now comes from the server.

**Find** in `src/types.ts`:

```ts
export const IMAGE_MODEL_OPTIONS = [
  { id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1', info: '最新旗艦圖片模型，預設推薦', badge: '預設' },
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', info: '速度極快，適合快速迭代' },
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', info: '細節更強，適合複雜佈局' }
] as const;
```

**Replace with:**

```ts
/** Default image model. The model list itself comes from the server (GET /api/image-models). */
export const DEFAULT_IMAGE_MODEL_ID = 'google:gemini-nano-banana-2.1';
```

Leave `MODEL_PRICING` in place for now. Part 3 replaces it.

## Step 2: imports in `src/App.tsx`

**Find** in `src/App.tsx`:

```tsx
import { 
  WHITELIST, RATIO_OPTIONS, MODEL_PRICING, IMAGE_MODEL_OPTIONS,
  OGImage, TokenLog, AppState, TemplatePresetSet,
  BASIC_MANGA_STYLES, MANGA_ARTIST_STYLES
} from './types';
```

**Replace with:**

```tsx
import { 
  WHITELIST, RATIO_OPTIONS, MODEL_PRICING, DEFAULT_IMAGE_MODEL_ID,
  OGImage, TokenLog, AppState, TemplatePresetSet,
  BASIC_MANGA_STYLES, MANGA_ARTIST_STYLES
} from './types';
import { MASK_REFERENCE_ONLY_NOTE, TEMPERATURE_SUPPORT_NOTE, modelIssue } from '@hk01/pi-ai-extra-image-kit';
import { ErrorPanel, ImageModelIssue, ImageModelSelector, findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
```

## Step 3: mount the error panel

The image kit's error panel shows every reported error with its provider, model, error code and task id, and has a 「複製錯誤資訊」 button. Mount it once, outside `AppContent`, so that it also shows on the login screen. Part 3 sends errors to it.

**Find** in `src/App.tsx`:

```tsx
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
```

**Replace with:**

```tsx
export default function App() {
  return (
    <>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
      {/* image-kit error panel: mounted once, outside screens that can unmount */}
      <ErrorPanel />
    </>
  );
}
```

## Step 4: default model and saved state

Two places set the default model: `defaultState` at the top of `AppContent`, and the 「還原」 (restore) button near the end of the file. Change both.

**Find every occurrence** in `src/App.tsx`:

```tsx
selectedModel: 'gemini-nano-banana-2.1',
```

**Replace with:**

```tsx
selectedModel: DEFAULT_IMAGE_MODEL_ID,
```

When the saved state is restored from `localStorage`, an old model ID (without a `provider:` prefix) is reset to the default.

**Find** in `src/App.tsx`:

```tsx
      if (
        !parsed.selectedModel ||
        parsed.selectedModel === ('gemini-3.1-flash-lite-image' as any) ||
        !IMAGE_MODEL_OPTIONS.some(m => m.id === parsed.selectedModel)
      ) {
        parsed.selectedModel = 'gemini-nano-banana-2.1';
      }
```

**Replace with:**

```tsx
      // Saved IDs from before the provider migration have no "provider:" prefix. Any other unknown
      // ID is reset by ImageModelSelector once the model list has loaded.
      if (typeof parsed.selectedModel !== 'string' || !parsed.selectedModel.includes(':')) {
        parsed.selectedModel = DEFAULT_IMAGE_MODEL_ID;
      }
```

## Step 5: load the model lists

Replace the state of the old custom dropdown with the model lists and the values derived from them:

- `generate` is the list for `/api/generate-og-image`, and `edit` is the list for `/api/deep-edit`. They come from the routes' scopes in `server/imageModels.ts`.
- The reference count is what one generation sends: the active template (if any), every source image, and the brand logo (if any).

**Find** in `src/App.tsx`:

```tsx
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
```

**Replace with:**

```tsx
  // --- Image models (server catalogue policy; each route has its own scope) ---
  const {
    models: imageModels,
    loading: imageModelsLoading,
    failed: imageModelsFailed,
    reload: reloadImageModels,
  } = useImageModels('generate');
  const { models: editImageModels } = useImageModels('edit');
  const selectedImageModel = findImageModel(imageModels, state.selectedModel);
  const editImageModel = findImageModel(editImageModels, state.selectedModel);
  // Reference images one generation sends: active template + every source image + brand logo.
  const hasActiveTemplate = state.activeTemplateIndex !== null && !!state.templateImages[state.activeTemplateIndex];
  const imageModelNeeds = {
    referenceCount: (hasActiveTemplate ? 1 : 0) + state.sourceImages.length + (state.brandLogo ? 1 : 0),
  };
  // Generation waits for the model list and is blocked while the selected model cannot take the request.
  const imageModelBlocked = !selectedImageModel || modelIssue(selectedImageModel, imageModelNeeds) !== null;
  // Only some models accept temperature; the slider keeps its value while it is disabled.
  const temperatureSupported = selectedImageModel ? !!selectedImageModel.temperature : true;
  /** Label for a stored model: canonical IDs show the model's label, older records their saved name. */
  const modelLabel = (id: string) => findImageModel(imageModels, id)?.label ?? id;
```

## Step 6: the model selector in the header

Replace the custom dropdown with the image kit's selector:

- Models are grouped by provider.
- A model without a server key, or with a lower reference-image limit than the current images need, is shown disabled with the reason.
- If the list fails to load, the selector becomes a 「模型清單載入失敗，按此重試」 button.
- An unknown saved ID is reset to the default once the list has loaded.

Replace everything from the comment `{/* Model Selection Pull-down Menu */}` through the `</div>` that closes the dropdown wrapper:

**Replace from** `src/App.tsx`:

```tsx
          {/* Model Selection Pull-down Menu */}
          <div className="relative" ref={modelDropdownRef}>
```

**through:**

```tsx
              </div>
            )}
          </div>
```

**Replace with:**

```tsx
          {/* Image model selector (grouped by provider; disabled options show the reason) */}
          <ImageModelSelector
            models={imageModels}
            loading={imageModelsLoading}
            failed={imageModelsFailed}
            onReload={reloadImageModels}
            value={state.selectedModel}
            onChange={(id) => setState(prev => ({ ...prev, selectedModel: id }))}
            defaultModelId={DEFAULT_IMAGE_MODEL_ID}
            needs={imageModelNeeds}
            className="max-w-[16rem] px-3 py-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200/80 text-neutral-800 rounded-lg border border-neutral-200/80 transition-all shadow-xs"
          />
```

The next element after it must still be `<div className="flex items-center gap-3">` with the user's name and the logout button.

## Step 7: temperature control (AI忠實程度)

Only the Google models accept temperature. For any other model, disable the slider and the three preset buttons, keep the stored value, and say why. A `<fieldset disabled>` disables every control inside it.

**Find** in `src/App.tsx`:

```tsx
            {/* Slider Control Container */}
            <Card className="p-4 bg-gradient-to-b from-neutral-50/80 to-white border-neutral-200/80 shadow-sm space-y-3">
```

**Replace with:**

```tsx
            {!temperatureSupported && (
              <p className="text-xs text-neutral-500">{TEMPERATURE_SUPPORT_NOTE}</p>
            )}

            {/* Slider Control Container (disabled for models without temperature; the value is kept) */}
            <fieldset disabled={!temperatureSupported} className={cn(!temperatureSupported && "opacity-50")}>
            <Card className="p-4 bg-gradient-to-b from-neutral-50/80 to-white border-neutral-200/80 shadow-sm space-y-3">
```

Close the `fieldset` after that `Card`, at the end of the temperature section:

**Find** in `src/App.tsx`:

```tsx
                  <span className="text-[9px] opacity-80">1.2</span>
                </button>
              </div>
            </Card>
          </section>
```

**Replace with:**

```tsx
                  <span className="text-[9px] opacity-80">1.2</span>
                </button>
              </div>
            </Card>
            </fieldset>
          </section>
```

## Step 8: the 開始生成 button

Disable 開始生成 until the model list has loaded, and while the selected model cannot take the request (missing key, too many reference images). Show the reason above the button. The app never switches to another model by itself and never drops images.

**Find** in `src/App.tsx`:

```tsx
        <Button 
          size="lg" 
          className="h-16 px-8 rounded-full shadow-2xl gap-3 text-lg"
          onClick={generateOG}
          disabled={isGenerating}
        >
```

**Replace with:**

```tsx
        <ImageModelIssue
          model={selectedImageModel}
          needs={imageModelNeeds}
          className="max-w-xs rounded-xl bg-white px-4 py-2 text-xs font-semibold text-red-600 shadow-lg border border-red-100"
        />
        <Button 
          size="lg" 
          className="h-16 px-8 rounded-full shadow-2xl gap-3 text-lg"
          onClick={generateOG}
          disabled={isGenerating || imageModelBlocked}
        >
```

## Step 9: mask note in the deep editor

Models other than the Nano Banana family read the coloured brush marks only as a reference image, so an edit can also change areas outside the marks. Show the image kit's note above the 執行標記修改 button when such a model is selected.

**Find** in `src/App.tsx`:

```tsx
                      <div className="flex justify-end gap-2 pt-1 border-t border-neutral-200/50">
```

**Replace with:**

```tsx
                      {editImageModel?.maskEditing === 'reference-only' && (
                        <p className="text-[11px] text-amber-700">{MASK_REFERENCE_ONLY_NOTE}</p>
                      )}
                      <div className="flex justify-end gap-2 pt-1 border-t border-neutral-200/50">
```

## Step 10: model labels in the history preview and the cost log

New records store the canonical model ID. Show its label. Older records stored a display name such as `Nano Banana 2.1`, which `modelLabel()` shows unchanged.

**Find** in `src/App.tsx`:

```tsx
                        {previewModalImage.model}
```

**Replace with:**

```tsx
                        {modelLabel(previewModalImage.model)}
```

**Find** in `src/App.tsx`:

```tsx
                            {new Date(log.timestamp).toLocaleString()} • {log.model}
```

**Replace with:**

```tsx
                            {new Date(log.timestamp).toLocaleString()} • {modelLabel(log.model)}
```

## Step 11: check Part 2

1. `npm run lint` passes.
2. `src/App.tsx` and `src/types.ts` no longer contain `IMAGE_MODEL_OPTIONS`, `showModelDropdown` or `modelDropdownRef`.
3. `src/App.tsx` still contains `MODEL_PRICING` and `fetch('/api/generate-og-image'`. Part 3 changes these. Do not change them now.
4. Reply with every file you changed, and every step where the code did not match exactly and how you applied it.

Image generation still does not work until Part 3 is done. Do not start Part 3 until the user sends it.
