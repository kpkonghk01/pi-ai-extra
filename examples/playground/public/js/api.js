// Thin client for the local playground server.

export async function getCatalog() {
  const response = await fetch("/api/catalog");
  if (!response.ok) throw new Error(`catalog request failed: HTTP ${response.status}`);
  return response.json();
}

export async function postJson(path, body, signal) {
  const response = await fetch(path, {
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
  const response = await fetch(path, {
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
