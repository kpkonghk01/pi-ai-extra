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
