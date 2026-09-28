// Provider keys live in the page; "remember" opts into localStorage for this browser only.

const STORAGE_KEY = "pi-ai-extra-playground-keys";

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); keys then stay in memory only.
  }
}

export function setupKeys(root) {
  const inputs = [...root.querySelectorAll("input[data-key]")];
  const remember = root.querySelector("#remember-keys");
  const show = root.querySelector("#show-keys");

  const stored = readStored();
  if (stored) {
    remember.checked = true;
    for (const input of inputs) input.value = stored[input.dataset.key] ?? "";
  }

  const current = () => Object.fromEntries(inputs.map((input) => [input.dataset.key, input.value.trim()]));
  const persist = () => writeStored(remember.checked ? current() : null);

  for (const input of inputs) input.addEventListener("input", persist);
  remember.addEventListener("change", persist);
  show.addEventListener("change", () => {
    for (const input of inputs) input.type = show.checked ? "text" : "password";
  });

  return { get: (provider) => current()[provider] ?? "" };
}
