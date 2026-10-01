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
