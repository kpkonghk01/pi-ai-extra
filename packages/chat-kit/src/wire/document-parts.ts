import type { ChatDocument } from "../types.ts";
import { renderTextDocument, type DocumentPlacement, type PreparedDocument } from "../documents.ts";
import { TurnFailure } from "../errors.ts";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";

/** A PDF or image document, as a wire API's part builder sees it. */
export type FileDocument = Extract<PreparedDocument, { kind: "pdf" | "image" }>;

/**
 * One wire API's parts for each document form. The kit dispatches on the document's kind and
 * source in one place (`encodeDocument`); a wire only says what each form looks like.
 * `S` is the API's file reference: a URL the provider fetches, or the bytes inline.
 */
export interface DocumentEncoder<P, S> {
  /** A plain-text document, already rendered as a labelled `<document>` block. */
  text(text: string): P;
  /** A file the provider fetches from `url`. */
  url(url: string, document: FileDocument): S;
  /** A file sent inline as base64 bytes. */
  inline(base64: string, document: FileDocument): S;
  pdf(source: S, document: FileDocument): P;
  image(source: S, document: FileDocument): P;
}

export function encodeDocument<P, S>(document: PreparedDocument, encoder: DocumentEncoder<P, S>): P {
  if (document.kind === "text") return encoder.text(renderTextDocument(document));
  const source =
    document.source.type === "url" ? encoder.url(document.source.url, document) : encoder.inline(document.source.data, document);
  return document.kind === "pdf" ? encoder.pdf(source, document) : encoder.image(source, document);
}

/** A PDF or image goes by URL when the document has one, inline otherwise (every API but Gemini). */
export function placeByUrl(document: ChatDocument): DocumentPlacement {
  return document.url === undefined ? "inline" : "url";
}

/** A text reader for parts that name their type (OpenAI, Anthropic): the text of a part whose `type` is `type`. */
export function textOfType(type: string): (part: Record<string, unknown>) => string | undefined {
  return (part) => (part.type === type && typeof part.text === "string" ? part.text : undefined);
}

/** A text reader for parts without a `type` (Gemini): the text of any part with a string `text`. */
export function textOfUntypedPart(part: Record<string, unknown>): string | undefined {
  return typeof part.text === "string" ? part.text : undefined;
}

/** Where one wire API's transcript keeps its text parts. */
export interface MarkerSite {
  /** The field of each transcript entry that holds its parts: `content` or `parts`. */
  partsKey: "content" | "parts";
  /** The text of a text part, or undefined for any other part. */
  textOf(part: Record<string, unknown>): string | undefined;
}

/**
 * Replaces the document marker in a transcript (`messages`, `input` or `contents`) with the
 * documents' parts, exactly once. Each entry's parts list is spliced; an entry whose parts are a
 * plain string must not contain the marker (it could not be replaced by parts). A marker that is
 * missing, repeated, or merged into other text fails the turn: documents are never silently
 * dropped or duplicated. Pure: the transcript is not mutated.
 */
export function replaceDocumentMarker(
  transcript: unknown,
  marker: string,
  replacement: readonly Record<string, unknown>[],
  site: MarkerSite,
): unknown[] {
  let found = 0;
  const entries = Array.isArray(transcript) ? transcript : [];
  const result = entries.map((entry: unknown) => {
    if (!isRecord(entry)) return entry;
    const parts = entry[site.partsKey];
    if (typeof parts === "string") {
      if (parts.includes(marker)) throw markerError("was merged into a plain-text message");
      return entry;
    }
    if (!Array.isArray(parts)) return entry;
    const spliced: unknown[] = [];
    for (const part of parts as unknown[]) {
      const text = isRecord(part) ? site.textOf(part) : undefined;
      if (text === marker) {
        found += 1;
        spliced.push(...replacement);
      } else {
        if (text?.includes(marker)) throw markerError("was merged into other text");
        spliced.push(part);
      }
    }
    return { ...entry, [site.partsKey]: spliced };
  });
  if (found === 0) throw markerError("was not found in the request");
  if (found > 1) throw markerError(`appeared ${found} times`);
  return result;
}

function markerError(problem: string): TurnFailure {
  return new TurnFailure("UNSUPPORTED", `chat-kit could not place the documents in this request: the document marker ${problem}.`);
}
