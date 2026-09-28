// Builds option controls from the package catalogue (ImageModelInfo), so the form only
// offers documented values. Empty selection = omit the field (provider default).

const OPTION_FIELDS = [
  ["aspectRatio", "Aspect ratio"],
  ["resolution", "Resolution"],
  ["background", "Background"],
  ["outputFormat", "Output format"],
];

const HARM_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];

function field(labelText, control) {
  const label = document.createElement("label");
  label.append(labelText, control);
  return label;
}

function select(name, values, emptyLabel) {
  const element = document.createElement("select");
  element.dataset.option = name;
  const options = emptyLabel === null ? values : ["", ...values];
  for (const value of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "" ? emptyLabel : value;
    element.append(option);
  }
  return element;
}

export function renderModelOptions(container, provider, info) {
  const controls = [];
  for (const [name, label] of OPTION_FIELDS) {
    const spec = info[name];
    if (!spec) continue;
    const emptyLabel = spec.required ? null : `(omit${spec.default ? `, provider default ${spec.default}` : ""})`;
    controls.push(field(`${label}${spec.required ? " *" : ""}`, select(name, spec.values, emptyLabel)));
  }
  if (info.watermark) controls.push(field("Watermark", select("watermark", ["true", "false"], "(omit, default false)")));
  if (provider === "toapis") {
    const input = document.createElement("input");
    input.dataset.option = "clientBusinessId";
    input.placeholder = "e.g. playground:req-1";
    controls.push(field("clientBusinessId (optional)", input));
  }
  if (provider === "google") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.option = "safetyBlockNone";
    const label = document.createElement("label");
    label.className = "inline";
    label.append(checkbox, " safetySettings: BLOCK_NONE for all categories");
    controls.push(label);
  }
  container.replaceChildren(...controls);
}

export function readModelOptions(container) {
  const options = {};
  for (const element of container.querySelectorAll("[data-option]")) {
    const name = element.dataset.option;
    if (name === "safetyBlockNone") {
      if (element.checked) options.safetySettings = HARM_CATEGORIES.map((category) => ({ category, threshold: "BLOCK_NONE" }));
      continue;
    }
    const value = element.value.trim();
    if (!value) continue;
    options[name] = name === "watermark" ? value === "true" : value;
  }
  return options;
}

export function describeModel(info) {
  const refs = info.referenceImages;
  const limit = refs.max === null ? "no documented limit" : refs.max === 0 ? "none" : `${refs.min}–${refs.max}`;
  const parts = [
    `<strong>${info.name}</strong> · ${info.kind}`,
    `reference images: ${limit} (${refs.acceptedMimeTypes.join(", ")}, inline ≤ ${Math.round(refs.maxInlineBytes / 1048576)} MiB)`,
    info.promptMaxLength ? `prompt ≤ ${info.promptMaxLength} chars` : "",
    ...info.notes,
  ];
  return parts.filter(Boolean).join("<br>");
}
