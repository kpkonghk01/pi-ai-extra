import type { ChatProviderTraits, ModelRate } from "@hk01/pi-ai-extra-internal/pi-ai";
import { isOfferedGeminiId } from "./live-models.ts";

/**
 * The chat kit's traits of a Gemini chat provider, on Google AI Studio or Agent Platform: Gemini
 * takes PDF and image documents and tools; the chat kit offers its plain text chat models
 * (`isOfferedGeminiId`). A `gemini-*` model reads PDFs when it reads images and takes tools. A
 * `gemma-4-*` model takes tools too (Google documents function calling for Gemma 4 on the Gemini
 * API), but no PDFs: Google's document-processing page names Gemini models only. Any other id takes
 * neither, until Google documents it. `rateOf` prices a model. Gemini reports no charge, so every
 * turn is estimated.
 */
export function geminiChatTraits(rateOf: (modelId: string) => ModelRate | undefined): ChatProviderTraits {
  return {
    takes: { fileDocuments: true, tools: true, nativeStructuredOutput: false },
    offers: (model) => (model.type ?? "chat") === "chat" && isOfferedGeminiId(model.id),
    describe: (model) => {
      const rate = rateOf(model.id);
      // Off until documented: function calling for Gemini and Gemma 4, PDF input for Gemini.
      const gemini = model.id.startsWith("gemini-");
      const tools = gemini || model.id.startsWith("gemma-4-");
      return { fileInput: gemini && model.input.includes("image"), tools, ...(rate === undefined ? {} : { rate }) };
    },
    reportedCostUsd: () => undefined,
    estimatesCost: true,
  };
}
