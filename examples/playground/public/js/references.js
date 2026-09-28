// Reference image picker: local files become data URLs (the package uploads them via
// the selected provider); URLs are passed through. Order: files first, then URLs.

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function setupReferences(elements, getLimit, log) {
  const { fileInput, urlInput, list, badge } = elements;
  let files = [];

  const urls = () =>
    urlInput.value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const all = () => [...files.map((file) => file.dataUrl), ...urls()];

  function render() {
    const items = [
      ...files.map((file, index) => ({ src: file.dataUrl, label: `${file.name} (${Math.round(file.size / 1024)} KiB)`, remove: () => removeFile(index) })),
      ...urls().map((url) => ({ src: url, label: url, remove: undefined })),
    ];
    list.replaceChildren(
      ...items.map((item, index) => {
        const figure = document.createElement("div");
        figure.className = "thumb";
        const img = document.createElement("img");
        img.src = item.src;
        img.alt = item.label;
        const caption = document.createElement("div");
        caption.textContent = `#${index} ${item.label.slice(0, 40)}`;
        figure.append(img, caption);
        if (item.remove) {
          const button = document.createElement("button");
          button.textContent = "×";
          button.title = "Remove";
          button.addEventListener("click", item.remove);
          figure.append(button);
        }
        return figure;
      }),
    );
    const limit = getLimit();
    const count = items.length;
    const max = limit?.max ?? null;
    const min = limit?.min ?? 0;
    badge.textContent = `${count} / ${max === null ? "no documented limit" : max}${min > 0 ? ` (min ${min})` : ""}`;
    badge.classList.toggle("over", (max !== null && count > max) || count < min);
  }

  function removeFile(index) {
    files = files.filter((_, i) => i !== index);
    render();
  }

  fileInput.addEventListener("change", async () => {
    const selected = [...fileInput.files];
    fileInput.value = "";
    for (const file of selected) {
      try {
        files = [...files, { name: file.name, size: file.size, dataUrl: await readAsDataUrl(file) }];
      } catch (error) {
        log.error(`Could not read ${file.name}`, { message: String(error) });
      }
    }
    render();
  });
  urlInput.addEventListener("input", render);

  return { all, render };
}
