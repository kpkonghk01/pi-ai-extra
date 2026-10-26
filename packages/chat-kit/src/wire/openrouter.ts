import type { Api, Model } from "@earendil-works/pi-ai";
import { isRecord } from "@hk01/pi-ai-extra-internal/util";

/**
 * OpenRouter's PDF parser pinned to the model's native file input. Without it, OpenRouter falls
 * back to its paid `mistral-ocr` engine for a model that cannot read files natively.
 */
export const OPENROUTER_FILE_PARSER = { id: "file-parser", pdf: { engine: "native" } } as const;

/** The request's `plugins` with the file parser pinned to `native`, replacing any other file-parser setting. */
export function withFileParser(plugins: unknown): unknown[] {
  const others = Array.isArray(plugins) ? plugins.filter((plugin) => !(isRecord(plugin) && plugin.id === "file-parser")) : [];
  return [...others, OPENROUTER_FILE_PARSER];
}

/** Whether a model's requests go to OpenRouter: its provider is `openrouter`, or its base URL is on `openrouter.ai`. */
export function targetsOpenRouter(model: Model<Api>): boolean {
  if (model.provider === "openrouter") return true;
  try {
    const host = new URL(model.baseUrl).hostname;
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}
