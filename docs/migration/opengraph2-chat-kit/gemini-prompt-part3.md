# opengraph2: move the Analysis step to the chat kit — part 3 of 3: UI: choose the analysis model, and decide after a failure

You are editing this Google AI Studio app, "OpenGraph2 圖片製作大師" (opengraph2). This is **part 3 of 3**; parts 1 and 2 are already applied. Part 3 changes the UI: a select in the header for the Analysis step's model, a modal that lets the user decide what happens when the Analysis step fails, and the removal of an automatic retry in the image generation loop.

Before you start, check that part 2 is applied: the file `server/analysisModels.ts` must exist, and `src/types.ts` must export `DEFAULT_ANALYSIS_MODEL_ID`. If either is missing, stop and say so.

## Rules

1. **Change only what the steps say.** Keep every prompt text, label, layout and style exactly as it is.
2. **No fallback and no retry.** Do not add another model, another provider or a second attempt anywhere. The user chooses; the app never chooses for them.
3. **Do not edit history.** Do not edit Markdown files (`*.md`), and do not edit anything inside a folder whose name contains `migration` (for example `pi-ai-extra-migration/`). They hold notes and snapshots from earlier migrations.
4. **A Find is exact.** Each "Find" text must occur in the file exactly the number of times the step says (once unless stated). If it does not, **stop and report which step and what you found instead.** Do not guess and do not edit something similar.
5. Copy the "Replace with" text exactly, including indentation. Do not reformat, rename or "improve" it.
6. If something does not fit the steps, describe it in your final report instead of fixing it.

## Step 3.1: Add the analysis model to the app state

File: `src/types.ts`

Why: The user's choice is saved with the rest of the state, like the image model.

**Find**: this text occurs exactly once in `src/types.ts`:

```ts
  selectedModel: string;
```

**Replace with**:

```ts
  selectedModel: string;
  /** Analysis step model key, `provider:modelId` (for example 'kie:gemini-3-8-flash'). The list comes from the server (GET /api/analysis-models). */
  analysisModel: string;
```

## Step 3.2: Import the new type and default, and keep the choice in the state

File: `src/App.tsx`

Why: The analysis model is part of `AppState`: a default for a new state, and a default for a saved state that has none.

**Find** (edit 1 of 4): this text occurs exactly once in `src/App.tsx`:

```tsx
  WHITELIST, RATIO_OPTIONS, USD_TO_HKD, DEFAULT_IMAGE_MODEL_ID,
  OGImage, TokenLog, AppState, TemplatePresetSet,
```

**Replace with**:

```tsx
  WHITELIST, RATIO_OPTIONS, USD_TO_HKD, DEFAULT_IMAGE_MODEL_ID, DEFAULT_ANALYSIS_MODEL_ID,
  OGImage, TokenLog, AppState, AnalysisChoice, AnalysisModelView, TemplatePresetSet,
```

**Find** (edit 2 of 4): this text occurs exactly once in `src/App.tsx`:

```tsx
      selectedModel: DEFAULT_IMAGE_MODEL_ID,
      layoutPrompts: {},
```

**Replace with**:

```tsx
      selectedModel: DEFAULT_IMAGE_MODEL_ID,
      analysisModel: DEFAULT_ANALYSIS_MODEL_ID,
      layoutPrompts: {},
```

**Find** (edit 3 of 4): this text occurs exactly once in `src/App.tsx`:

```tsx
                selectedModel: DEFAULT_IMAGE_MODEL_ID,
                layoutPrompts: {},
```

**Replace with**:

```tsx
                selectedModel: DEFAULT_IMAGE_MODEL_ID,
                analysisModel: DEFAULT_ANALYSIS_MODEL_ID,
                layoutPrompts: {},
```

**Find** (edit 4 of 4): this text occurs exactly once in `src/App.tsx`:

```tsx
      const templateImages = parsed.templateImages || (parsed.templateImage ? [parsed.templateImage] : []);
```

**Replace with**:

```tsx
      // The analysis model list comes from the server; an unknown saved key is reset once it has loaded.
      if (typeof parsed.analysisModel !== 'string' || !parsed.analysisModel.includes(':')) {
        parsed.analysisModel = DEFAULT_ANALYSIS_MODEL_ID;
      }

      const templateImages = parsed.templateImages || (parsed.templateImage ? [parsed.templateImage] : []);
```

## Step 3.3: Load the analysis models and add the failure choice

File: `src/App.tsx`

Why: The list comes from the server. The same place holds what the failure modal needs: a promise that the Analysis step awaits until the user chooses.

**Find**: this text occurs exactly once in `src/App.tsx`:

```tsx
  const modelLabel = (id: string) => findImageModel(imageModels, id)?.label ?? id;
```

**Replace with**:

```tsx
  const modelLabel = (id: string) => findImageModel(imageModels, id)?.label ?? id;

  // --- Analysis step models (server-owned list; the user's choice is never changed for them) ---
  const [analysisModels, setAnalysisModels] = useState<AnalysisModelView[]>([]);
  const [analysisModelsLoading, setAnalysisModelsLoading] = useState(true);
  const [analysisModelsFailed, setAnalysisModelsFailed] = useState(false);
  const loadAnalysisModels = async () => {
    setAnalysisModelsLoading(true);
    setAnalysisModelsFailed(false);
    try {
      const res = await fetch('/api/analysis-models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnalysisModels(Array.isArray(data.models) ? data.models : []);
    } catch (err) {
      console.warn('[OG Maker] 無法載入分析模型清單：', err);
      setAnalysisModelsFailed(true);
    } finally {
      setAnalysisModelsLoading(false);
    }
  };
  useEffect(() => { loadAnalysisModels(); }, []);
  // A saved key the server no longer offers goes back to the default.
  useEffect(() => {
    if (analysisModels.length > 0 && !analysisModels.some(m => m.key === state.analysisModel)) {
      setState(prev => ({ ...prev, analysisModel: DEFAULT_ANALYSIS_MODEL_ID }));
    }
  }, [analysisModels, state.analysisModel]);
  const analysisModelLabel = (key: string) => analysisModels.find(m => m.key === key)?.label ?? key;

  // When the Analysis step fails, the user decides what happens next: run it again, go on with the
  // original instruction, or cancel. The generation waits here for that choice.
  const [analysisFailure, setAnalysisFailure] = useState<{ message: string; model: string } | null>(null);
  const analysisChoiceRef = useRef<((choice: AnalysisChoice) => void) | null>(null);
  // The modal covers the page, so its own buttons are the only way to answer it.
  const askAnalysisChoice = (message: string, model: string) =>
    new Promise<AnalysisChoice>((resolve) => {
      analysisChoiceRef.current = (choice) => {
        analysisChoiceRef.current = null;
        setAnalysisFailure(null);
        resolve(choice);
      };
      setAnalysisFailure({ message, model });
    });
```

## Step 3.4: Add the analysis model selector to the header

File: `src/App.tsx`

Why: A native select next to the image model selector, with the same look. Models whose key the server lacks stay visible but disabled, with the reason.

**Find**: this text occurs exactly once in `src/App.tsx`:

```tsx
          {/* Image model selector (grouped by provider; disabled options show the reason) */}
```

**Replace with**:

```tsx
          {/* Analysis model selector (the text model of the Analysis step; grouped by provider, disabled options show the reason) */}
          {analysisModelsFailed && analysisModels.length === 0 ? (
            <button
              type="button"
              onClick={loadAnalysisModels}
              title="重新載入分析模型清單"
              className="max-w-[16rem] px-3 py-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200/80 text-neutral-800 rounded-lg border border-neutral-200/80 transition-all shadow-xs"
            >
              分析模型清單載入失敗，按此重試
            </button>
          ) : (
            <select
              value={state.analysisModel}
              onChange={(e) => setState(prev => ({ ...prev, analysisModel: e.target.value }))}
              disabled={analysisModelsLoading && analysisModels.length === 0}
              title="分析樣板與指令使用的文字模型"
              className="max-w-[16rem] px-3 py-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200/80 text-neutral-800 rounded-lg border border-neutral-200/80 transition-all shadow-xs"
            >
              {analysisModels.length === 0 ? (
                <option value={state.analysisModel}>載入分析模型中…</option>
              ) : (
                [...new Set(analysisModels.map(m => m.providerLabel))].map(providerLabel => (
                  <optgroup key={providerLabel} label={providerLabel}>
                    {analysisModels.filter(m => m.providerLabel === providerLabel).map(m => (
                      <option key={m.key} value={m.key} disabled={!m.available && m.key !== state.analysisModel}>
                        {m.available ? m.label : `${m.label}（${m.reason}）`}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          )}

          {/* Image model selector (grouped by provider; disabled options show the reason) */}
```

## Step 3.5: Run the Analysis step on the chosen model, and let the user decide after a failure

File: `src/App.tsx`

Why: Today a failed analysis is skipped without telling the user (KIE and ToAPIs image models) or stops everything (Google). Now every failure goes to the ErrorPanel and to a modal, and nothing is retried, skipped or switched without the user's choice.

**Find** (edit 1 of 3): this text occurs exactly once in `src/App.tsx`:

```tsx
      // 1. Gemini 3.8 Flash Analysis via Server
```

**Replace with**:

```tsx
      // 1. Analysis step via the server, on the model the user picked in the header
```

**Find** (edit 2 of 3): this text occurs exactly once in `src/App.tsx`:

```tsx
      let refinedPrompt = state.prompt || '';
      try {
        const analyzeRes = await fetch('/api/analyze-og', {
          method: 'POST',
          signal: abort.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promptText,
            activeTemplate,
            sourceImages: resolvedSourceImages,
            brandLogo: resolvedBrandLogo,
            reasoningModel: 'gemini-3.8-flash',
          })
        });

        if (analyzeRes.ok) {
          const analyzeData = await analyzeRes.json();
          refinedPrompt = analyzeData.refinedPrompt || state.prompt || '';
          console.log('Refined Prompt:', refinedPrompt);
        } else {
          const errData = await analyzeRes.json().catch(() => ({}));
          const errMsg = errData.error || `分析樣板指令失敗 (${analyzeRes.status})`;
          if (state.selectedModel.startsWith('google:')) {
            throw new Error(errMsg);
          } else {
            console.warn(`[OG Maker] Google Gemini 分析服務不可用 (${errMsg})，將使用原始提示詞直接透過 ${state.selectedModel} 生成圖片。`);
          }
        }
      } catch (err: any) {
        if (state.selectedModel.startsWith('google:')) {
          throw err;
        }
        console.warn('[OG Maker] 樣板分析步驟跳過，使用原始指令進行圖像生成：', err?.message || err);
      }
```

**Replace with**:

```tsx
      let refinedPrompt = state.prompt || '';
      // One attempt per click. A failure goes to the ErrorPanel, and the user decides in a modal whether to
      // run the analysis again, go on with the original instruction, or cancel. Nothing is retried, skipped
      // or switched to another model without that choice.
      while (true) {
        try {
          const analyzeRes = await fetch('/api/analyze-og', {
            method: 'POST',
            signal: abort.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              promptText,
              activeTemplate,
              sourceImages: resolvedSourceImages,
              brandLogo: resolvedBrandLogo,
              analysisModel: state.analysisModel,
            })
          });

          if (!analyzeRes.ok) {
            const errData = await analyzeRes.json().catch(() => ({}));
            throw new ImageRequestError(
              errData.error || `分析樣板指令失敗 (${analyzeRes.status})`,
              errData.details ?? {},
              analyzeRes.status,
            );
          }
          const analyzeData = await analyzeRes.json();
          if (typeof analyzeData.refinedPrompt !== 'string' || !analyzeData.refinedPrompt.trim()) {
            throw new ImageRequestError('分析模型沒有寫出生圖指令。', { appModelId: state.analysisModel }, analyzeRes.status);
          }
          refinedPrompt = analyzeData.refinedPrompt;
          console.log('Refined Prompt:', refinedPrompt);
          break;
        } catch (err: any) {
          if (isAbort(err, abort.signal)) throw err;
          reportError(err, '分析樣板與指令', { model: state.analysisModel });
          const choice = await askAnalysisChoice(err?.message || String(err), state.analysisModel);
          if (choice === 'cancel') {
            abort.abort();
            throw err;
          }
          if (choice === 'skip') break;
        }
      }
```

**Find** (edit 3 of 3): this text occurs exactly once in `src/App.tsx`:

```tsx
      // The text analysis failed (image errors are reported per ratio above); 取消 is not an error.
      if (!isAbort(error, abort.signal)) {
        console.error('Generation error:', error);
        reportError(error, '分析樣板與指令', { model: 'gemini-3.8-flash' });
```

**Replace with**:

```tsx
      // An unexpected failure: the Analysis step and each ratio report their own failures above; 取消 is not an error.
      if (!isAbort(error, abort.signal)) {
        console.error('Generation error:', error);
        reportError(error, '生成 OG 圖');
```

## Step 3.6: Remove the image generation retry

File: `src/App.tsx`

Why: The loop sent the same request a second time after a network error. The rule is one attempt: a failure is reported, and the user decides.

**Find** (edit 1 of 2): this text occurs exactly once in `src/App.tsx`:

```tsx
        // 2. Image generation with the selected provider/model: with 1 retry on network interruption
```

**Replace with**:

```tsx
        // 2. Image generation with the selected provider/model: one attempt, no retry
```

**Find** (edit 2 of 2): this text occurs exactly once in `src/App.tsx`:

```tsx
          let rawBase64 = '';
          const maxAttempts = 2;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              const res = await postImageRequest('/api/generate-og-image', {
                model: state.selectedModel,
                generatorPrompt,
                activeTemplate,
                sourceImages: resolvedSourceImages,
                brandLogo: resolvedBrandLogo,
                temperature: state.temperature ?? 0.7,
                ratio: ratioId,
              }, abort.signal);
              rawBase64 = res.imageUrl;
              break;
            } catch (postErr: any) {
              if (isAbort(postErr, abort.signal)) throw postErr;
              const errStr = String(postErr?.message || postErr).toLowerCase();
              const isNetworkError = postErr instanceof TypeError || errStr.includes('network') || errStr.includes('failed to fetch');
              if (attempt < maxAttempts && isNetworkError) {
                console.warn(`[generateOG] 網路連線短暫中斷 (${ratioId})，1.5 秒後自動重試...`, postErr);
                setGenerationProgress(`連線短暫不穩定 (${ratioId})，正在自動重新連線...`);
                await new Promise(r => setTimeout(r, 1500));
                continue;
              }
              throw postErr;
            }
          }
```

**Replace with**:

```tsx
          const res = await postImageRequest('/api/generate-og-image', {
            model: state.selectedModel,
            generatorPrompt,
            activeTemplate,
            sourceImages: resolvedSourceImages,
            brandLogo: resolvedBrandLogo,
            temperature: state.temperature ?? 0.7,
            ratio: ratioId,
          }, abort.signal);
          const rawBase64 = res.imageUrl;
```

## Step 3.7: Add the failure modal

File: `src/App.tsx`

Why: It shows the failure and three choices. The ErrorPanel (z-index 9999) stays above it, so the details are readable while the modal is open.

**Find**: this text occurs exactly once in `src/App.tsx`:

```tsx
      {/* Deep Editing Modal */}
```

**Replace with**:

```tsx
      {/* Analysis step failure: the user decides what happens next */}
      <AnimatePresence>
        {analysisFailure && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm"
          >
            <Card className="max-w-md w-full bg-white border-none shadow-2xl rounded-2xl overflow-hidden">
              <div className="p-5 space-y-3">
                <h3 className="font-bold text-base flex items-center gap-2 text-neutral-900">
                  <AlertCircle size={18} className="text-red-500" />
                  分析樣板與指令失敗
                </h3>
                <p className="text-xs text-neutral-500">分析模型：{analysisModelLabel(analysisFailure.model)}</p>
                <p className="text-sm text-neutral-700 break-words">{analysisFailure.message}</p>
                <p className="text-xs text-neutral-500">詳細錯誤資訊見畫面上的錯誤面板。不會自動重試，也不會改用其他模型。</p>
              </div>
              <div className="p-4 border-t bg-neutral-50/80 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => analysisChoiceRef.current?.('cancel')}>取消</Button>
                <Button variant="outline" size="sm" onClick={() => analysisChoiceRef.current?.('skip')}>略過分析，用原始指令繼續生圖</Button>
                <Button variant="primary" size="sm" onClick={() => analysisChoiceRef.current?.('retry')}>重新分析</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Deep Editing Modal */}
```

## Checkpoint

Run `npm run lint`.

- An error that was already there before your changes is not yours (for example `'ErrorBoundary' cannot be used as a JSX component` in `src/App.tsx`). Report it, and leave it.
- Any other error comes from one of the steps above: fix your edit so it matches the step exactly, and run `npm run lint` again.

Then report: each step number with *done* or *stopped*, and the result of `npm run lint`.
