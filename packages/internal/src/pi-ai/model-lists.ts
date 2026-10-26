import type { Api, Model } from "@earendil-works/pi-ai";
import { isRecord } from "../util.ts";
import { modelIdKey } from "../model-id.ts";

/**
 * GETs a provider's model list as JSON, under the list read's `signal`. A non-2xx status, a body
 * that is not JSON, or KIE's HTTP-200 error envelope (`{ code, msg }`) throws, with the
 * provider's own message when it gave one.
 */
export async function getModelListJson(
  fetch: typeof globalThis.fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", ...headers },
    signal,
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${withoutQuery(url)}`);
    throw new Error(`the model list from ${withoutQuery(url)} is not JSON`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${withoutQuery(url)}${detail(body)}`);
  if (isRecord(body) && typeof body.code === "number" && body.code !== 200 && typeof body.msg === "string" && !("data" in body)) {
    throw new Error(`code ${body.code} from ${withoutQuery(url)}: ${clip(body.msg)}`);
  }
  return body;
}

/**
 * The model ids of an OpenAI-style list, `{ data: [{ id }] }`, read defensively: a bare array and
 * string entries are accepted too, entries without an id are skipped, and anything else throws.
 */
export function modelIdsOf(body: unknown, source: string): string[] {
  const entries = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.data) ? body.data : undefined;
  if (entries === undefined) throw new Error(`the model list from ${source} has no data array`);
  const ids = entries.flatMap((entry: unknown) => {
    if (typeof entry === "string") return entry ? [entry] : [];
    return isRecord(entry) && typeof entry.id === "string" && entry.id ? [entry.id] : [];
  });
  if (ids.length === 0) throw new Error(`the model list from ${source} lists no model ids`);
  return ids;
}

/**
 * The package's models whose ids the live lists name, in package order, matched across `.` and
 * `-` spellings. None at all is treated as a failed read, not as an empty list: with an
 * undocumented list shape it more likely means the ids were not recognised, and the previous list
 * stays in use.
 */
export function keepListed<TApi extends Api>(
  installed: readonly Model<TApi>[],
  listFor: (model: Model<TApi>) => ReadonlySet<string>,
  provider: string,
): Model<TApi>[] {
  const kept = installed.filter((model) => listFor(model).has(modelIdKey(model.id)));
  if (kept.length === 0) throw new Error(`the ${provider} model lists name none of the package's chat models`);
  return kept;
}

/** A reported amount (a cost or credits): a finite, non-negative number, otherwise not reported. */
export function reportedAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function detail(body: unknown): string {
  if (!isRecord(body)) return "";
  const error = body.error;
  const message = isRecord(error) && typeof error.message === "string" ? error.message : typeof body.msg === "string" ? body.msg : undefined;
  return message ? `: ${clip(message)}` : "";
}

function clip(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** The URL without its query string, which may carry a key on some APIs. */
function withoutQuery(url: string): string {
  return url.split("?", 1)[0]!;
}
