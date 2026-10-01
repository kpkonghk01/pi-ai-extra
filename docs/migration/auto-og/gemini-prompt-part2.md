# Auto OG migration, Part 2 of 3: client building blocks

Continue the same task (Part 1 is already applied). The rules from Part 1 still apply.

This part only **adds** client modules and extends `TemperatureControl` with an optional prop. It changes no existing behaviour, so `npm run lint` must still pass afterwards.

## Step 7: create the client modules

Create each file with exactly this content:
- `services/imageApi.ts` reads the server's NDJSON stream. It makes one attempt and has no retry. An `AbortSignal` (the cancel buttons) closes the stream, so the server stops polling.
- `services/errorReporter.ts` collects errors for the panel and formats the copyable report. A panel that mounts later still gets the latest error.
- `components/useImageModels.ts` loads `GET /api/image-models` once. If that fails, the error goes to the panel and `reload()` tries again.
- `components/ImageModelSelector.tsx` is the selector, grouped by provider:
  - A model without a server key, or with a lower reference-image limit, stays visible but disabled, and its label says why.
  - If the list failed to load, it shows a retry button instead.
  - `ImageModelIssue` is the red hint shown under the selector and near the Generate buttons.
- `components/ErrorPanel.tsx` is the error panel:
  - It is hidden until an error is reported.
  - When an error is reported, it appears in the bottom-right corner, above modals.
  - It has 「複製錯誤資訊」, collapse and close buttons.

`services/imageApi.ts`:

```ts
import type { ImageErrorDetails, ImageModelView } from '../shared/imageModels';

export type { ImageErrorDetails };

export class ImageRequestError extends Error {
  readonly details: ImageErrorDetails;
  /** HTTP status of the response, when the server rejected the request before streaming. */
  readonly httpStatus: number | undefined;
  constructor(message: string, details: ImageErrorDetails = {}, httpStatus?: number) {
    super(message);
    this.name = 'ImageRequestError';
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

interface StreamEvent {
  type?: string;
  rawImageBase64?: string;
  error?: string;
  details?: ImageErrorDetails;
}

/** Handles one NDJSON line; returns the image for `complete`, throws for `error`, ignores start/ping. */
function handleLine(line: string, ignored: string[]): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    // Not one of the server's JSON lines (for example proxy padding); reported if no result follows.
    ignored.push(trimmed.slice(0, 200));
    return undefined;
  }
  if (event.type === 'error') throw new ImageRequestError(event.error || '生成失敗', event.details ?? {});
  if (event.type !== 'complete') return undefined;
  if (!event.rawImageBase64) throw new ImageRequestError('伺服器沒有返回圖片。', { code: 'no_output' });
  return event.rawImageBase64;
}

/**
 * POSTs an image request and reads the server's NDJSON stream (start, ping…, complete | error).
 * Resolves with the raw image data URL. One attempt only: billed requests are never re-sent.
 * Aborting `signal` (the cancel buttons) closes the stream, so the server stops polling the provider;
 * the abort error is rethrown as is so callers can treat it as a cancellation.
 */
export async function postImageRequest(url: string, payload: unknown, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ImageRequestError(`無法連線到伺服器：${error instanceof Error ? error.message : String(error)}`, { code: 'network' });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ImageRequestError(data.error || `伺服器回應 ${response.status} ${response.statusText}`, data.details ?? {}, response.status);
  }
  if (!response.body) throw new ImageRequestError('伺服器沒有返回內容。', { code: 'invalid_response' });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const ignored: string[] = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const image = handleLine(line, ignored);
      if (image) {
        reader.cancel().catch(() => undefined);
        return image;
      }
    }
    if (done) break;
  }
  const last = handleLine(buffer, ignored);
  if (last) return last;
  const extra = ignored.length > 0 ? `（收到 ${ignored.length} 行無法解析的內容，例如：${ignored[0]}）` : '';
  throw new ImageRequestError(`連線在完成前中斷，沒有收到結果${extra}。`, { code: 'stream_ended' });
}

export async function fetchImageModels(): Promise<ImageModelView[]> {
  const response = await fetch('/api/image-models');
  if (!response.ok) throw new ImageRequestError(`無法載入圖片模型清單（HTTP ${response.status}）。`, { code: 'models_unavailable' }, response.status);
  const data: unknown = await response.json().catch(() => null);
  const models = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) throw new ImageRequestError('圖片模型清單格式不正確。', { code: 'invalid_response' });
  return models as ImageModelView[];
}
```


`services/errorReporter.ts`:

```ts
import { ImageRequestError } from './imageApi';
import type { ImageErrorDetails } from '../shared/imageModels';

/**
 * Collects server errors for the ErrorPanel so users can copy an exact report.
 * Any component can call reportError(); the panel shows the latest one.
 */

export type ErrorOperation = 'collage' | 'edit' | 'titles' | 'article' | 'page-images' | 'image-models';

export interface ErrorEntry {
  id: number;
  at: string;
  operation: ErrorOperation;
  message: string;
  details: ImageErrorDetails;
  httpStatus: number | undefined;
  /** Extra facts such as "第 2/4 張 (16:9)". */
  context: Readonly<Record<string, string>>;
}

const OPERATION_LABELS: Record<ErrorOperation, string> = {
  collage: '拼貼生成',
  edit: '圖片編輯',
  titles: '標題生成',
  article: '讀取文章',
  'page-images': '擷取網頁圖片',
  'image-models': '載入圖片模型清單',
};

type Listener = (entry: ErrorEntry) => void;
const listeners = new Set<Listener>();
let nextId = 1;
/** Latest error, replayed to a panel that mounts after it was reported. */
let latest: ErrorEntry | null = null;

export function operationLabel(operation: ErrorOperation): string {
  return OPERATION_LABELS[operation];
}

export function reportError(error: unknown, operation: ErrorOperation, context: Record<string, string | number | undefined> = {}): ErrorEntry {
  const entry: ErrorEntry = {
    id: nextId++,
    at: new Date().toISOString(),
    operation,
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof ImageRequestError ? error.details : {},
    httpStatus: error instanceof ImageRequestError ? error.httpStatus : undefined,
    context: Object.fromEntries(Object.entries(context).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]]))),
  };
  latest = entry;
  listeners.forEach((listener) => listener(entry));
  return entry;
}

export function subscribeErrors(listener: Listener): () => void {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
  };
}

/** Plain-text report for bug reports: everything the panel shows, one fact per line. */
export function formatErrorReport(entry: ErrorEntry): string {
  const { details } = entry;
  const lines = [
    `操作: ${operationLabel(entry.operation)}`,
    `時間: ${entry.at}`,
    details.appModelId ? `App model: ${details.appModelId}` : '',
    details.provider || details.model ? `Provider/model: ${details.provider ?? '-'}/${details.model ?? '-'}` : '',
    details.code ? `Error code: ${details.code}` : '',
    details.status !== undefined ? `Provider HTTP status: ${details.status}` : '',
    entry.httpStatus !== undefined ? `App HTTP status: ${entry.httpStatus}` : '',
    details.providerCode ? `Provider code: ${details.providerCode}` : '',
    details.taskId ? `Task id: ${details.taskId}` : '',
    ...Object.entries(entry.context).map(([key, value]) => `${key}: ${value}`),
    `訊息: ${entry.message}`,
    `頁面: ${typeof location === 'undefined' ? '-' : location.href}`,
  ];
  return lines.filter(Boolean).join('\n');
}
```


`components/useImageModels.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { fetchImageModels } from '../services/imageApi';
import { reportError } from '../services/errorReporter';
import type { ImageModelView } from '../shared/imageModels';

interface ImageModelsState {
  models: ImageModelView[];
  loading: boolean;
  /** True after a failed load; reload() tries again. */
  failed: boolean;
}

/** One shared request per page load. A failed load is reported to the ErrorPanel and can be retried. */
let pending: Promise<ImageModelView[]> | null = null;

export function useImageModels(): ImageModelsState & { reload: () => void } {
  const [state, setState] = useState<ImageModelsState>({ models: [], loading: true, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    pending ??= fetchImageModels();
    pending.then(
      (models) => {
        if (active) setState({ models, loading: false, failed: false });
      },
      (error: unknown) => {
        pending = null;
        reportError(error, 'image-models');
        if (active) setState({ models: [], loading: false, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    setAttempt((value) => value + 1);
  }, []);
  return { ...state, reload };
}

export function findImageModel(models: readonly ImageModelView[], id: string): ImageModelView | undefined {
  return models.find((model) => model.id === id);
}
```


`components/ImageModelSelector.tsx`:

```tsx
import React from 'react';
import { modelIssue, PROVIDER_ORDER, type ImageModelView } from '../shared/imageModels';

interface ImageModelSelectorProps {
  models: readonly ImageModelView[];
  value: string;
  onChange: (id: string) => void;
  /** Reference images the next request will send; options that cannot take them are disabled. */
  referenceCount: number;
  loading?: boolean;
  /** The model list failed to load; show a retry button instead of an empty list. */
  failed?: boolean;
  onReload?: () => void;
  className?: string;
}

/**
 * Image model picker grouped by provider (Google, KIE, ToAPIs). Models without a server key or
 * with a lower reference-image limit stay visible but disabled, with the reason in the label.
 */
export const ImageModelSelector: React.FC<ImageModelSelectorProps> = ({ models, value, onChange, referenceCount, loading, failed, onReload, className }) => {
  if (failed && models.length === 0) {
    return (
      <button type="button" onClick={onReload} className={className} title="重新載入圖片模型清單">
        模型清單載入失敗，按此重試
      </button>
    );
  }
  if (loading && models.length === 0) {
    return (
      <select disabled className={className} value="">
        <option value="">載入模型中…</option>
      </select>
    );
  }
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={className} title="圖片生成模型">
      {PROVIDER_ORDER.map((provider) => {
        const group = models.filter((model) => model.provider === provider);
        if (group.length === 0) return null;
        return (
          <optgroup key={provider} label={group[0]?.providerLabel ?? provider}>
            {group.map((model) => {
              const issue = modelIssue(model, referenceCount);
              return (
                <option key={model.id} value={model.id} disabled={issue !== null && model.id !== value}>
                  {issue ? `${model.label}（${issue}）` : model.label}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
};

interface ImageModelIssueProps {
  model: ImageModelView | undefined;
  referenceCount: number;
  className?: string;
}

/** Red hint shown near the Generate button when the selected model cannot run as configured. */
export const ImageModelIssue: React.FC<ImageModelIssueProps> = ({ model, referenceCount, className }) => {
  if (!model) return null;
  const issue = modelIssue(model, referenceCount);
  if (!issue) return null;
  const fix = model.available ? '請移除部分圖片，或改選其他模型。' : '請改選其他模型，或請管理員設定金鑰。';
  return (
    <p role="status" className={className ?? 'mt-2 text-xs font-semibold text-red-600'}>
      目前模型「{model.label}」{issue}。{fix}
    </p>
  );
};
```


`components/ErrorPanel.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Copy, X } from 'lucide-react';
import { formatErrorReport, operationLabel, subscribeErrors, type ErrorEntry } from '../services/errorReporter';

/** Copies text, falling back to a hidden textarea where the Clipboard API is blocked (some iframes). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

/**
 * Hidden until a server error is reported. Shows the latest error with provider/model, code,
 * status and task id, and copies a plain-text report. A new error re-opens the panel.
 */
export const ErrorPanel: React.FC = () => {
  const [entry, setEntry] = useState<ErrorEntry | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(
    () =>
      subscribeErrors((next) => {
        setEntry(next);
        setCollapsed(false);
        setCopyState('idle');
      }),
    [],
  );

  if (!entry) return null;
  const report = formatErrorReport(entry);
  const where = [entry.details.provider, entry.details.model].filter(Boolean).join('/');

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[9999] flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg notranslate"
      >
        <AlertTriangle size={14} /> 錯誤資訊
      </button>
    );
  }

  return (
    <div role="alert" className="fixed bottom-4 right-4 z-[9999] w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-red-300 bg-white text-sm shadow-2xl notranslate">
      <div className="flex items-center justify-between gap-2 rounded-t-xl bg-red-50 px-3 py-2">
        <span className="flex items-center gap-1.5 font-bold text-red-700">
          <AlertTriangle size={16} /> {operationLabel(entry.operation)}失敗{where ? `（${where}）` : ''}
        </span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setCollapsed(true)} title="收起" className="rounded p-1 text-gray-500 hover:bg-red-100">
            <ChevronDown size={16} />
          </button>
          <button type="button" onClick={() => setEntry(null)} title="關閉" className="rounded p-1 text-gray-500 hover:bg-red-100">
            <X size={16} />
          </button>
        </span>
      </div>
      <div className="space-y-2 px-3 py-2">
        <p className="break-words text-gray-800">{entry.message}</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[11px] text-gray-600 select-all">{report}</pre>
        <button
          type="button"
          onClick={async () => setCopyState((await copyText(report)) ? 'copied' : 'failed')}
          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
        >
          <Copy size={14} />
          {copyState === 'copied' ? '已複製' : copyState === 'failed' ? '複製失敗，請手動選取上方文字' : '複製錯誤資訊'}
        </button>
      </div>
    </div>
  );
};
```


## Step 8: `components/TemperatureControl.tsx`

Add the optional `disabledReason` prop.
- When it is set, the slider and presets are disabled and greyed out.
- The reason is shown above them: only Google Gemini's own Nano Banana 2 / Pro accept temperature.
- The stored value is kept, so switching back to a Google model restores it.

```diff
diff --git a/components/TemperatureControl.tsx b/components/TemperatureControl.tsx
index 0af96b8..505963e 100644
--- a/components/TemperatureControl.tsx
+++ b/components/TemperatureControl.tsx
@@ -5,13 +5,17 @@ interface TemperatureControlProps {
   temperature: number;
   onChange: (value: number) => void;
   compact?: boolean;
+  /** Shown instead of enabling the control when the selected model does not accept temperature. */
+  disabledReason?: string | null;
 }
 
 export const TemperatureControl: React.FC<TemperatureControlProps> = ({
   temperature,
   onChange,
   compact = false,
+  disabledReason = null,
 }) => {
+  const disabled = disabledReason !== null;
   const [showTooltip, setShowTooltip] = useState(false);
 
   // Quick preset values
@@ -30,7 +34,7 @@ export const TemperatureControl: React.FC<TemperatureControlProps> = ({
   const activeLabel = getActivePreset();
 
   return (
-    <div className={`bg-gray-50/70 border border-gray-200 rounded-2xl ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'} transition-all`}>
+    <div className={`bg-gray-50/70 border border-gray-200 rounded-2xl ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'} transition-all`} aria-disabled={disabled}>
       {/* Header */}
       <div className="flex items-center justify-between">
         <div className="flex items-center gap-2">
@@ -111,8 +115,14 @@ export const TemperatureControl: React.FC<TemperatureControlProps> = ({
         </div>
       </div>
 
-      {/* Range Slider */}
-      <div className="space-y-1.5">
+      {disabled && (
+        <p role="note" className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
+          {disabledReason}（已保留目前設定，切回支援的模型時會沿用）
+        </p>
+      )}
+
+      {/* Range Slider (the value is kept while disabled) */}
+      <fieldset disabled={disabled} className={`space-y-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
         <input
           type="range"
           min="0.1"
@@ -150,7 +160,7 @@ export const TemperatureControl: React.FC<TemperatureControlProps> = ({
             );
           })}
         </div>
-      </div>
+      </fieldset>
     </div>
   );
 };
```


## Step 9: check Part 2

Run `npm run lint`. It must pass.
