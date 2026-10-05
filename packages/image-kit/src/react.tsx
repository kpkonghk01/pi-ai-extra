import { useEffect, useState, useSyncExternalStore, type CSSProperties, type FC, type ReactNode } from 'react';
import { fetchImageModels, formatErrorReport, reportError, subscribeErrors, type ErrorEntry } from './browser.ts';
import { modelIssue, referenceIssue, type ImageModelView, type ImageProvider, type ModelNeeds } from './models.ts';

/**
 * React UI: model list hook, provider-grouped selector, issue hint and error panel. The app
 * styles the selector and hint through className props. The panel uses inline styles, because
 * Tailwind does not scan packages in node_modules.
 */

export interface ImageModelsState {
  models: ImageModelView[];
  loading: boolean;
  /** True after a failed load; reload() tries again. */
  failed: boolean;
}

/**
 * The model list is loaded once per page and shared by every component that uses it. A failed
 * load is reported to the ErrorPanel once; reload() from any component retries for all of them.
 */
let snapshot: ImageModelsState = { models: [], loading: true, failed: false };
let pending: Promise<void> | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: ImageModelsState): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function loadImageModels(): void {
  if (pending) return;
  started = true;
  publish({ ...snapshot, loading: true, failed: false });
  pending = fetchImageModels().then(
    (models) => {
      pending = null;
      publish({ models, loading: false, failed: false });
    },
    (error: unknown) => {
      pending = null;
      reportError(error, '載入圖片模型清單');
      publish({ models: snapshot.models, loading: false, failed: true });
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): ImageModelsState => snapshot;

export function useImageModels(): ImageModelsState & { reload: () => void } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!started) loadImageModels();
  }, []);
  return { ...state, reload: loadImageModels };
}

export function findImageModel(models: readonly ImageModelView[], id: string): ImageModelView | undefined {
  return models.find((model) => model.id === id);
}

/** Providers in the order their first model appears in the server's list (the app's config order). */
function providerOrder(models: readonly ImageModelView[]): ImageProvider[] {
  return [...new Set(models.map((model) => model.provider))];
}

const identity = (text: string): string => text;

export interface ImageModelSelectorProps {
  models: readonly ImageModelView[];
  value: string;
  onChange: (id: string) => void;
  /** Set when the loaded list does not contain `value` (a saved id of a removed model). */
  defaultModelId: string;
  /** What the next request needs; options that cannot serve it are disabled with the reason. */
  needs: ModelNeeds;
  loading?: boolean;
  /** The model list failed to load; show a retry button instead of an empty list. */
  failed?: boolean;
  onReload?: () => void;
  className?: string;
  optionClassName?: string;
  /** Converts labels for display (for example to Simplified Chinese). */
  formatLabel?: (text: string) => string;
}

/**
 * Image model picker grouped by provider, in the app's model order. Models without a server key,
 * with a lower reference-image limit or without the chosen strict resolution stay visible but
 * disabled, with the reason in the label.
 */
export const ImageModelSelector: FC<ImageModelSelectorProps> = ({
  models,
  value,
  onChange,
  defaultModelId,
  needs,
  loading,
  failed,
  onReload,
  className,
  optionClassName,
  formatLabel = identity,
}) => {
  const known = models.length === 0 || findImageModel(models, value) !== undefined;
  useEffect(() => {
    if (!known && value !== defaultModelId) onChange(defaultModelId);
  }, [known, value, defaultModelId, onChange]);

  if (failed && models.length === 0) {
    return (
      <button type="button" onClick={onReload} className={className} title="重新載入圖片模型清單">
        {formatLabel('模型清單載入失敗，按此重試')}
      </button>
    );
  }
  if (loading && models.length === 0) {
    return (
      <select disabled className={className} value="">
        <option value="" className={optionClassName}>
          {formatLabel('載入模型中…')}
        </option>
      </select>
    );
  }
  const selected = findImageModel(models, value);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={className} title={selected ? formatLabel(selected.description) : undefined}>
      {providerOrder(models).map((provider) => {
        const group = models.filter((model) => model.provider === provider);
        return (
          <optgroup key={provider} label={formatLabel(group[0]?.providerLabel ?? provider)} className={optionClassName}>
            {group.map((model) => {
              const issue = modelIssue(model, needs);
              return (
                <option key={model.id} value={model.id} disabled={issue !== null && model.id !== value} className={optionClassName}>
                  {formatLabel(issue ? `${model.label}（${issue}）` : model.label)}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
};

export interface ImageModelIssueProps {
  model: ImageModelView | undefined;
  needs: ModelNeeds;
  /** Replaces the default red text style. */
  className?: string;
  formatLabel?: (text: string) => string;
}

const ISSUE_STYLE: CSSProperties = { marginTop: 8, fontSize: 12, fontWeight: 600, color: '#dc2626' };

/** Red hint shown near the Generate button when the selected model cannot run as configured. */
export const ImageModelIssue: FC<ImageModelIssueProps> = ({ model, needs, className, formatLabel = identity }) => {
  if (!model) return null;
  const issue = modelIssue(model, needs);
  if (!issue) return null;
  const { max } = model.referenceLimit;
  const fix = !model.available
    ? '請改選其他模型，或請管理員設定金鑰。'
    : referenceIssue(model, needs.referenceCount)
      ? max !== null && needs.referenceCount > max
        ? '請移除部分圖片，或改選其他模型。'
        : '請加入參考圖，或改選其他模型。'
      : '請改選其他模型或解像度。';
  return (
    <p role="status" className={className} style={className ? undefined : ISSUE_STYLE}>
      {formatLabel(`目前模型「${model.label}」${issue}。${fix}`)}
    </p>
  );
};

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

/** 16 px stroke icons (Lucide shapes), so the package needs no icon library. */
function Icon({ size = 16, children }: { size?: number; children: ReactNode }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const AlertIcon = ({ size }: { size?: number }): ReactNode => (
  <Icon size={size ?? 16}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);
const ChevronIcon = (): ReactNode => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
const CloseIcon = (): ReactNode => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
const CopyIcon = (): ReactNode => (
  <Icon size={14}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>
);

const RED = '#dc2626';
const PANEL_STYLES: Record<string, CSSProperties> = {
  pill: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9999,
    border: 'none',
    background: RED,
    color: '#fff',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 700,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.2)',
    cursor: 'pointer',
  },
  panel: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    zIndex: 9999,
    width: 'min(28rem, calc(100vw - 2rem))',
    borderRadius: 12,
    border: '1px solid #fca5a5',
    background: '#fff',
    color: '#1f2937',
    fontSize: 14,
    lineHeight: 1.45,
    textAlign: 'left',
    boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: '12px 12px 0 0',
    background: '#fef2f2',
    padding: '8px 12px',
  },
  title: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#b91c1c' },
  iconButton: { display: 'flex', border: 'none', background: 'transparent', color: '#6b7280', padding: 4, borderRadius: 4, cursor: 'pointer' },
  body: { display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px 12px' },
  message: { margin: 0, overflowWrap: 'anywhere' },
  report: {
    margin: 0,
    maxHeight: 160,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    borderRadius: 4,
    background: '#f9fafb',
    padding: 8,
    fontSize: 11,
    color: '#4b5563',
    userSelect: 'all',
  },
  copy: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    border: 'none',
    borderRadius: 8,
    background: RED,
    color: '#fff',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
};

/**
 * Hidden until an error is reported. Shows the latest error with provider/model, code, status
 * and task id, and copies a plain-text report. A new error re-opens the panel. Mount it once,
 * outside any screen that can unmount (login, modals).
 */
export const ErrorPanel: FC = () => {
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
      <button type="button" onClick={() => setCollapsed(false)} className="notranslate" style={PANEL_STYLES.pill}>
        <AlertIcon size={14} /> 錯誤資訊
      </button>
    );
  }

  return (
    <div role="alert" className="notranslate" style={PANEL_STYLES.panel}>
      <div style={PANEL_STYLES.header}>
        <span style={PANEL_STYLES.title}>
          <AlertIcon /> {entry.operation}失敗{where ? `（${where}）` : ''}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" onClick={() => setCollapsed(true)} title="收起" style={PANEL_STYLES.iconButton}>
            <ChevronIcon />
          </button>
          <button type="button" onClick={() => setEntry(null)} title="關閉" style={PANEL_STYLES.iconButton}>
            <CloseIcon />
          </button>
        </span>
      </div>
      <div style={PANEL_STYLES.body}>
        <p style={PANEL_STYLES.message}>{entry.message}</p>
        <pre style={PANEL_STYLES.report}>{report}</pre>
        <button type="button" onClick={async () => setCopyState((await copyText(report)) ? 'copied' : 'failed')} style={PANEL_STYLES.copy}>
          <CopyIcon />
          {copyState === 'copied' ? '已複製' : copyState === 'failed' ? '複製失敗，請手動選取上方文字' : '複製錯誤資訊'}
        </button>
      </div>
    </div>
  );
};
