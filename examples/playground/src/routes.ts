import type { ServerResponse } from "node:http";
import { createModels } from "@earendil-works/pi-ai";
import { generateGoogleImage, GOOGLE_IMAGE_MODELS, type GoogleImageRequest } from "@hk01/pi-ai-extra-google";
import { createGoogleProvider, GOOGLE_CHAT_MODEL_IDS } from "@hk01/pi-ai-extra-google/pi-ai";
import { generateKieImage, getKieTask, KIE_IMAGE_MODELS, type KieImageRequest } from "@hk01/pi-ai-extra-kie";
import { createKieProvider, KIE_CHAT_MODELS } from "@hk01/pi-ai-extra-kie/pi-ai";
import { generateToapisImage, getToapisTask, TOAPIS_IMAGE_MODELS, type ToapisImageRequest } from "@hk01/pi-ai-extra-toapis";
import { createToapisProvider, TOAPIS_CHAT_MODELS } from "@hk01/pi-ai-extra-toapis/pi-ai";
import { z } from "zod";
import { HttpError, openNdjson, sendJson, serializeError } from "./http-utils.ts";

const imageBody = z.object({
  provider: z.enum(["kie", "toapis", "google"]),
  apiKey: z.string().trim().min(1, "apiKey is required"),
  request: z.record(z.string(), z.unknown()),
});

const taskBody = z.object({
  provider: z.enum(["kie", "toapis"]),
  apiKey: z.string().trim().min(1, "apiKey is required"),
  taskId: z.string().trim().min(1, "taskId is required"),
  model: z.string().optional(),
});

const chatBody = z.object({
  provider: z.enum(["kie", "toapis", "google"]),
  apiKey: z.string().trim().min(1, "apiKey is required"),
  model: z.string().min(1),
  prompt: z.string().trim().min(1, "prompt is required"),
});

export function catalogRoute(response: ServerResponse): void {
  sendJson(response, 200, {
    image: { kie: KIE_IMAGE_MODELS, toapis: TOAPIS_IMAGE_MODELS, google: GOOGLE_IMAGE_MODELS },
    chat: { kie: KIE_CHAT_MODELS, toapis: TOAPIS_CHAT_MODELS, google: GOOGLE_CHAT_MODEL_IDS.map((id) => ({ id })) },
  });
}

/** Streams progress events, then the result (images + usage) or a serialized error. */
export async function imageRoute(body: unknown, response: ServerResponse): Promise<void> {
  const input = parse(imageBody, body);
  const stream = openNdjson(response);
  const common = {
    apiKey: input.apiKey,
    signal: stream.signal,
    onProgress: (event: unknown) => stream.write({ type: "progress", event }),
  };
  try {
    const result =
      input.provider === "kie"
        ? await generateKieImage({ ...input.request, ...common } as KieImageRequest)
        : input.provider === "toapis"
          ? await generateToapisImage({ ...input.request, ...common } as ToapisImageRequest)
          : await generateGoogleImage({ ...input.request, ...common } as GoogleImageRequest);
    stream.write({ type: "result", result });
  } catch (error) {
    stream.write({ type: "error", error: serializeError(error) });
  } finally {
    stream.end();
  }
}

/** Re-reads a KIE/ToAPIs task by id (for example to settle `pending` billing). */
export async function taskRoute(body: unknown, response: ServerResponse): Promise<void> {
  const input = parse(taskBody, body);
  try {
    const options = { apiKey: input.apiKey, taskId: input.taskId, model: input.model };
    const task = input.provider === "kie" ? await getKieTask(options) : await getToapisTask(options);
    sendJson(response, 200, { ok: true, task });
  } catch (error) {
    sendJson(response, 200, { ok: false, error: serializeError(error) });
  }
}

const CHAT_PROVIDERS = {
  kie: (apiKey: string) => createKieProvider({ apiKey }),
  toapis: (apiKey: string) => createToapisProvider({ apiKey }),
  google: (apiKey: string) => createGoogleProvider({ apiKey }),
};

/** One-message smoke test through pi-ai `Models` with the selected chat provider. */
export async function chatRoute(body: unknown, response: ServerResponse): Promise<void> {
  const input = parse(chatBody, body);
  const models = createModels();
  models.setProvider(CHAT_PROVIDERS[input.provider](input.apiKey));
  const model = models.getModel(input.provider, input.model);
  if (!model) throw new HttpError(400, `Unknown ${input.provider} chat model ${input.model}.`);
  const startedAt = Date.now();
  const message = await models.complete(model, {
    messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
  });
  sendJson(response, 200, {
    ok: message.stopReason !== "error" && message.stopReason !== "aborted",
    provider: message.provider,
    model: message.model,
    api: model.api,
    baseUrl: model.baseUrl,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
    usage: message.usage,
    elapsedMs: Date.now() - startedAt,
  });
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new HttpError(400, parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "));
}
