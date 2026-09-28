import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { isPiAiExtraError } from "@hk01/pi-ai-extra-kie";

const MAX_BODY_BYTES = 150 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is larger than 150 MB.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(payload);
}

/** Serves files from `root` only; rejects traversal outside it. */
export async function sendStatic(response: ServerResponse, root: string, urlPath: string): Promise<void> {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const filePath = normalize(join(root, relative));
  if (!filePath.startsWith(root + sep)) throw new HttpError(403, "Forbidden.");
  const contentType = CONTENT_TYPES[extname(filePath)];
  if (!contentType) throw new HttpError(404, "Not found.");
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") throw new HttpError(404, "Not found.");
    throw error;
  }
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  response.end(content);
}

/** JSON-serialisable description of any error, keeping pi-ai-extra context (provider, model, code, taskId…). */
export function serializeError(error: unknown): Record<string, unknown> {
  if (isPiAiExtraError(error)) return { ...error.toJSON() };
  if (error instanceof HttpError) return { name: "HttpError", status: error.status, message: error.message };
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 8).join("\n") };
  }
  return { name: "UnknownError", message: String(error) };
}

/** Writes newline-delimited JSON events; `closed` tells whether the browser went away. */
export interface NdjsonStream {
  write: (event: Record<string, unknown>) => void;
  end: () => void;
  readonly signal: AbortSignal;
}

export function openNdjson(response: ServerResponse): NdjsonStream {
  const controller = new AbortController();
  response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  response.on("close", () => {
    if (!response.writableFinished) controller.abort(new Error("Browser closed the request (Cancel)."));
  });
  return {
    write: (event) => {
      if (!response.writableEnded) response.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
    },
    end: () => response.end(),
    signal: controller.signal,
  };
}
