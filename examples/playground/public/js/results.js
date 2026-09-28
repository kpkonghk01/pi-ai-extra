// Renders generated images, usage/billing, and errors.

function el(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  Object.assign(element, attributes);
  element.append(...children);
  return element;
}

export function renderResult(container, result, onRequery) {
  const cards = result.images.map((image, index) => {
    const extension = image.mimeType.split("/")[1] ?? "png";
    return el("div", { className: "result" }, [
      el("img", { src: image.dataUrl, alt: `result ${index}` }),
      el("div", { className: "status", textContent: `${image.mimeType} · ${(image.byteLength / 1024).toFixed(1)} KiB` }),
      el("a", { href: image.dataUrl, download: `${result.provider}-${result.model.replaceAll("/", "_")}-${index}.${extension}`, textContent: "Download" }),
    ]);
  });
  const usage = el("pre", { className: "output", textContent: JSON.stringify(result.usage ?? "provider reported no usage", null, 2) });
  const summary = el("div", {
    className: "status",
    textContent: `${result.provider}/${result.model} · task ${result.taskId ?? "–"} · ${(result.elapsedMs / 1000).toFixed(1)} s`,
  });
  const children = [summary, el("div", { className: "results" }, cards), el("h3", { textContent: "Usage / billing" }), usage];
  if (onRequery && result.taskId && result.provider !== "google") {
    const button = el("button", { textContent: "Re-query billing by task id" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const task = await onRequery(result);
        if (task) usage.textContent = JSON.stringify(task.usage ?? "provider reported no usage", null, 2);
      } finally {
        button.disabled = false;
      }
    });
    children.push(el("div", { className: "row" }, [button]));
  }
  container.replaceChildren(...children);
}

export function renderError(container, error) {
  const text = [
    error.provider && error.model ? `${error.provider}/${error.model}` : "",
    error.code ? `code: ${error.code}` : "",
    error.status ? `HTTP ${error.status}` : "",
    error.taskId ? `task: ${error.taskId}` : "",
    error.message ?? "Unknown error",
  ]
    .filter(Boolean)
    .join("\n");
  container.replaceChildren(el("div", { className: "error-box", textContent: text }));
}
