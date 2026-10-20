import { ratePeriodAt } from "@hk01/pi-ai-extra-internal/rates";
import { NATIVE_INPUT_FOR } from "../documents.ts";
import type { RegisteredProvider } from "../registry.ts";
import type { ChatModelInfo } from "../types.ts";
import { wireApiFor } from "../wire/index.ts";
import type { ListedModel } from "./list.ts";

/** Any schema: whether a model takes one does not depend on its shape. */
const PROBE_SCHEMA = { name: "probe", schema: { type: "object" } };

/** What a gateway admin needs to know about one listed model, with the rate in force at `now`. */
export function modelInfo(listed: ListedModel, provider: RegisteredProvider, now: number): ChatModelInfo {
  const { model } = listed;
  const wire = wireApiFor(model.api);
  const period = listed.rate === undefined ? undefined : ratePeriodAt(listed.rate, now);
  return {
    id: model.id,
    name: model.name,
    input: [...listed.input],
    fileDocuments:
      wire !== undefined &&
      provider.fileDocuments &&
      listed.input.includes(NATIVE_INPUT_FOR.pdf) &&
      listed.input.includes(NATIVE_INPUT_FOR.image),
    responseSchema:
      wire !== undefined &&
      wire.unsupported(model, { responseSchema: PROBE_SCHEMA, settings: {}, nativeStructuredOutput: provider.nativeStructuredOutput }) ===
        undefined,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    reasoning: model.reasoning,
    ...(period === undefined ? {} : { rate: period }),
  };
}
