import { randomUUID } from "node:crypto";
import type { ChatDocument } from "./types.ts";

/** How a document reaches the model: decoded into a text block, or as a native file/image part. */
export type DocumentKind = "text" | "pdf" | "image";

const DOCUMENT_KINDS: Readonly<Record<string, DocumentKind>> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "text/html": "text",
  "application/json": "text",
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
};

export const SUPPORTED_DOCUMENT_TYPES: readonly string[] = Object.keys(DOCUMENT_KINDS);

/** Lower-cased MIME type without parameters (`text/plain; charset=utf-8` → `text/plain`). */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]!.trim().toLowerCase();
}

export function documentKind(mimeType: string): DocumentKind | undefined {
  return DOCUMENT_KINDS[normalizeMimeType(mimeType)];
}

/** A document ready for a payload transform: its text, a URL the provider fetches, or inline bytes. */
export type PreparedDocument =
  | { kind: "text"; name: string; mimeType: string; text: string }
  | { kind: "pdf" | "image"; name: string; mimeType: string; source: DocumentSource };

export type DocumentSource = { type: "url"; url: string } | { type: "base64"; data: string };

/** Where a wire API puts a PDF or image: fetched by the provider from its URL, or sent inline. */
export type DocumentPlacement = "url" | "inline";

/**
 * Loads only what has to be sent: text documents (always decoded as UTF-8) and inline files.
 * A file placed by URL is never loaded.
 */
export async function prepareDocument(document: ChatDocument, kind: DocumentKind, placement: DocumentPlacement): Promise<PreparedDocument> {
  const mimeType = normalizeMimeType(document.mimeType);
  if (kind === "text") {
    const bytes = await document.load();
    return { kind, name: document.name, mimeType, text: new TextDecoder("utf-8").decode(bytes) };
  }
  if (placement === "url" && document.url !== undefined) {
    return { kind, name: document.name, mimeType, source: { type: "url", url: document.url } };
  }
  const bytes = await document.load();
  return { kind, name: document.name, mimeType, source: { type: "base64", data: Buffer.from(bytes).toString("base64") } };
}

/** The text block a plain-text document becomes, labelled with its file name. */
export function renderTextDocument(document: { name: string; text: string }): string {
  return `<document name="${document.name.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">\n${document.text}\n</document>`;
}

export function dataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}

/** A unique text part that marks where the documents go; each payload transform replaces it. */
export function createDocumentMarker(): string {
  return `[[chat-kit:documents:${randomUUID()}]]`;
}
