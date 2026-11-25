/** A server-sent-event response with one `data:` event per chunk, as Gemini streams. */
function sseResponse(chunks: readonly unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Gemini's whole answer to a turn, "Hi.", in one finished chunk with its usage. */
export function geminiAnswer(): Response {
  return sseResponse([
    {
      candidates: [{ content: { role: "model", parts: [{ text: "Hi." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 },
    },
  ]);
}
