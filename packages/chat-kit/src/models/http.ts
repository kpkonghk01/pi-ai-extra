import { isRecord } from "../guards.ts";

/**
 * GETs a provider's model list as JSON, under the list read's `signal` (its one deadline). A
 * non-2xx status, a body that is not JSON, or KIE's HTTP-200 error envelope (`{ code, msg }`)
 * throws, with the provider's own message when it gave one.
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
