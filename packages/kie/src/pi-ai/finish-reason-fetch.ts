import type { FetchFunction, ProviderStreams } from "@earendil-works/pi-ai";
import { fetchWrappedStreams } from "./envelope-fetch.ts";

/**
 * KIE's Gemini models on OpenAI Chat Completions (ADR 0010) stream their content, then a usage
 * chunk with KIE's `credits_consumed`, then `data: [DONE]`, and never send a `finish_reason`.
 * pi-ai's adapter then ends a successful turn with "Stream ended without finish_reason". This
 * fetch wrapper adds one `stop` chunk, in the same completion, after the usage chunk and before
 * `[DONE]` (or at the end of a stream that has no `[DONE]`), when the stream carried content and
 * no finish reason. A stream that has a finish reason, or no content, passes through untouched,
 * and so does every other route.
 *
 * KIE reports no reason for a reply cut off at the token limit either, so such a turn ends `stop`
 * too; the usage record's `output` against the limit is the only sign of it.
 */
export function kieFinishReasonFetch(base: FetchFunction): FetchFunction {
  return async (input, init) => {
    const response = await base(input, init);
    if (!response.ok || response.body === null || !isChatCompletionsStream(input, response)) return response;
    return new Response(response.body.pipeThrough(addMissingFinishReason()), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function kieFinishReasonStreams(inner: ProviderStreams): ProviderStreams {
  return fetchWrappedStreams(inner, kieFinishReasonFetch);
}

function isChatCompletionsStream(input: Parameters<FetchFunction>[0], response: Response): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return path.endsWith("/chat/completions") && (response.headers.get("content-type") ?? "").includes("text/event-stream");
}

interface Seen {
  content: boolean;
  finish: boolean;
  done: boolean;
  id: string | undefined;
  created: number | undefined;
}

const EVENT_END = /(\r?\n\r?\n)/;

/** Passes the SSE stream through, and adds the missing `stop` chunk where the stream ends. */
function addMissingFinishReason(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const seen: Seen = { content: false, finish: false, done: false, id: undefined, created: undefined };
  let pending = "";

  const missing = () => seen.content && !seen.finish;
  const stopChunk = (): Uint8Array => {
    seen.finish = true;
    const chunk = {
      ...(seen.id === undefined ? {} : { id: seen.id }),
      object: "chat.completion.chunk",
      ...(seen.created === undefined ? {} : { created: seen.created }),
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const parts = pending.split(EVENT_END);
      pending = parts.pop() ?? "";
      // `parts` alternates an event and the blank line that ended it.
      for (let index = 0; index < parts.length; index += 2) {
        const event = parts[index] ?? "";
        inspect(event, seen);
        if (seen.done && missing()) controller.enqueue(stopChunk());
        controller.enqueue(encoder.encode(event + (parts[index + 1] ?? "")));
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending !== "") {
        inspect(pending, seen);
        if (seen.done && missing()) controller.enqueue(stopChunk());
        controller.enqueue(encoder.encode(pending));
        if (!/\n$/.test(pending)) controller.enqueue(encoder.encode("\n\n"));
      }
      if (!seen.done && missing()) controller.enqueue(stopChunk());
    },
  });
}

/** Notes what one SSE event carries: the end marker, content, a finish reason, the completion's id. */
function inspect(event: string, seen: Seen): void {
  for (const line of event.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      seen.done = true;
      continue;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (typeof chunk !== "object" || chunk === null) continue;
    const record = chunk as { id?: unknown; created?: unknown; choices?: unknown };
    if (!Array.isArray(record.choices) || record.choices.length === 0) continue;
    if (!seen.content) {
      seen.content = true;
      seen.id = typeof record.id === "string" ? record.id : undefined;
      seen.created = typeof record.created === "number" ? record.created : undefined;
    }
    for (const choice of record.choices) {
      const reason = typeof choice === "object" && choice !== null ? (choice as { finish_reason?: unknown }).finish_reason : undefined;
      if (reason !== undefined && reason !== null) seen.finish = true;
    }
  }
}
