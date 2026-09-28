// Thin client for the local playground server.

/**
 * fetch() rejects with a bare "Failed to fetch" when the local server is not reachable
 * (stopped, crashed or restarted). Say so explicitly, without masking cancellation.
 */
async function localFetch(path, init) {
  try {
    return await fetch(path, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error(
      `Cannot reach the playground server at ${location.origin}${path} (${error?.message ?? error}). ` +
        "Is `pnpm playground` still running? Restart it, reload this page, and try again.",
      { cause: error },
    );
  }
}

export async function getCatalog() {
  const response = await localFetch("/api/catalog");
  if (!response.ok) throw new Error(`catalog request failed: HTTP ${response.status}`);
  return response.json();
}

export async function postJson(path, body, signal) {
  const response = await localFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { ok: false, error: { message: text } } };
  }
}

/** Posts and yields each NDJSON event from the streamed response. */
export async function* streamNdjson(path, body, signal) {
  const response = await localFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    let error;
    try {
      error = JSON.parse(text).error;
    } catch {
      error = { message: text };
    }
    yield { type: "error", error: { httpStatus: response.status, ...error } };
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}
