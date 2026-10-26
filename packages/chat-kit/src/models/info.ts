import type { Api, Model } from "@earendil-works/pi-ai";
import type { ChatProviderTraits } from "@hk01/pi-ai-extra-internal/pi-ai";
import type { ChatModel } from "../types.ts";
import { wireApiFor } from "../wire/index.ts";

/** Any schema: whether a model takes one does not depend on its shape. */
const PROBE_SCHEMA = { name: "probe", schema: { type: "object" } };

/** A listed model: pi-ai's own `Model`, with what a turn may send it under `chatKit`. */
export function chatModel(model: Model<Api>, traits: ChatProviderTraits): ChatModel {
  const described = traits.describe(model);
  const wire = wireApiFor(model.api);
  return {
    // A copy: `input`, `cost` and `compat` are shared with pi-ai's catalogue and other kits.
    ...structuredClone(model),
    chatKit: {
      fileInput: described.fileInput,
      fileDocuments: wire !== undefined && traits.takes.fileDocuments && described.fileInput && model.input.includes("image"),
      tools: wire !== undefined && traits.takes.tools && described.tools,
      responseSchema:
        wire !== undefined &&
        wire.unsupported(model, { responseSchema: PROBE_SCHEMA, reasoning: undefined, nativeStructuredOutput: traits.takes.nativeStructuredOutput }) ===
          undefined,
      ...(described.rate === undefined ? {} : { rate: structuredClone(described.rate) }),
    },
  };
}
