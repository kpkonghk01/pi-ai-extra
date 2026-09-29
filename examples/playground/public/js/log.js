// Copyable diagnostic log. Credentials are redacted and data URLs are shortened
// before anything is written, so the whole log can be pasted into a bug report.

const SECRET_KEYS = new Set(["apikey", "api_key", "authorization", "proxy-authorization", "x-api-key", "x-goog-api-key"]);

export function redact(value, depth = 0) {
  if (depth > 12) return "[depth limit]";
  if (typeof value === "string") {
    const match = /^data:([^;,]+);base64,/.exec(value);
    return match ? `data:${match[1]};base64,… (${value.length} chars)` : value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(item, depth + 1)]),
    );
  }
  return value;
}

export function createLog(container) {
  const entries = [];

  function add(level, message, data) {
    const text = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${
      data === undefined ? "" : `\n${JSON.stringify(redact(data), null, 2)}`
    }`;
    entries.push(text);
    const pre = document.createElement("pre");
    pre.className = level;
    pre.textContent = text;
    container.append(pre);
    container.scrollTop = container.scrollHeight;
  }

  async function copy() {
    const text = entries.join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand("copy");
    }
  }

  function clear() {
    entries.length = 0;
    container.replaceChildren();
  }

  return {
    info: (message, data) => add("info", message, data),
    ok: (message, data) => add("ok", message, data),
    warn: (message, data) => add("warn", message, data),
    error: (message, data) => add("error", message, data),
    copy,
    clear,
  };
}
