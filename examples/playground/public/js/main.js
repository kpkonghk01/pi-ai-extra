import { getCatalog, postJson, streamNdjson } from "./api.js";
import { describeModel, readModelOptions, renderModelOptions } from "./image-form.js";
import { setupKeys } from "./keys.js";
import { createLog } from "./log.js";
import { setupReferences } from "./references.js";
import { renderError, renderResult } from "./results.js";

const $ = (selector) => document.querySelector(selector);
const log = createLog($("#log"));
const keys = setupKeys($("#keys"));
let catalog;
let running;

$("#log-copy").addEventListener("click", async () => {
  const copied = await log.copy();
  $("#log-copy").textContent = copied ? "Copied" : "Select the log and copy manually";
  setTimeout(() => ($("#log-copy").textContent = "Copy log"), 1500);
});
$("#log-clear").addEventListener("click", () => log.clear());

const currentModel = () => catalog?.image[$("#image-provider").value]?.find((model) => model.id === $("#image-model").value);

const references = setupReferences(
  { fileInput: $("#ref-files"), urlInput: $("#ref-urls"), list: $("#ref-list"), badge: $("#ref-count") },
  () => currentModel()?.referenceImages,
  log,
);

function fillSelect(element, items) {
  element.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name && item.name !== item.id ? `${item.id} — ${item.name}` : item.id;
      return option;
    }),
  );
}

function onImageProviderChange() {
  fillSelect($("#image-model"), catalog.image[$("#image-provider").value]);
  onImageModelChange();
}

function onImageModelChange() {
  const info = currentModel();
  if (!info) return;
  $("#model-info").innerHTML = describeModel(info);
  renderModelOptions($("#model-options"), $("#image-provider").value, info);
  references.render();
}

function buildImageRequest() {
  const timeout = Number($("#image-timeout").value);
  const request = {
    model: $("#image-model").value,
    prompt: $("#image-prompt").value,
    ...readModelOptions($("#model-options")),
  };
  const refs = references.all();
  if (refs.length > 0) request.referenceImages = refs;
  if (timeout > 0) request.timeoutMs = timeout;
  return request;
}

function describeProgress(event) {
  switch (event.type) {
    case "task_submitted":
      return `task submitted: ${event.taskId}`;
    case "task_status":
      return `task ${event.taskId}: ${event.status} (${(event.elapsedMs / 1000).toFixed(0)} s)`;
    case "upload_completed":
      return `uploaded reference #${event.index}`;
    case "download_started":
      return `downloading ${event.index + 1}/${event.total}`;
    default:
      return event.type;
  }
}

async function generate() {
  const provider = $("#image-provider").value;
  const apiKey = keys.get(provider);
  const request = buildImageRequest();
  const controller = new AbortController();
  running = controller;
  $("#generate").disabled = true;
  $("#cancel").disabled = false;
  $("#image-results").replaceChildren();
  const startedAt = Date.now();
  const timer = setInterval(() => ($("#image-status").textContent = `running… ${((Date.now() - startedAt) / 1000).toFixed(0)} s`), 500);
  log.info(`image request → ${provider}/${request.model}`, { provider, apiKey: apiKey ? "set" : "missing", request });

  try {
    for await (const message of streamNdjson("/api/image", { provider, apiKey, request }, controller.signal)) {
      if (message.type === "progress") {
        const event = message.event;
        (event.type === "warning" ? log.warn : log.info)(`progress: ${describeProgress(event)}`, event);
      } else if (message.type === "result") {
        const { images, ...rest } = message.result;
        log.ok(`image result ← ${provider}/${request.model}: ${images.length} image(s)`, { ...rest, images });
        renderResult($("#image-results"), message.result, requery);
      } else if (message.type === "error") {
        log.error(`image error ← ${provider}/${request.model}`, message.error);
        renderError($("#image-results"), message.error);
      }
    }
  } catch (error) {
    const details = { name: error?.name, message: String(error?.message ?? error) };
    log.error(controller.signal.aborted ? "image request cancelled in browser" : "image request failed in browser", details);
    renderError($("#image-results"), details);
  } finally {
    clearInterval(timer);
    $("#image-status").textContent = `finished in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`;
    $("#generate").disabled = false;
    $("#cancel").disabled = true;
    running = undefined;
  }
}

async function requery(result) {
  const body = { provider: result.provider, apiKey: keys.get(result.provider), taskId: result.taskId, model: result.model };
  log.info(`task lookup → ${result.provider} ${result.taskId}`);
  const response = await postJson("/api/task", body);
  if (response.body.ok) {
    log.ok(`task lookup ← ${result.provider} ${result.taskId}: ${response.body.task.status ?? response.body.task.state}`, response.body.task);
    return response.body.task;
  }
  log.error(`task lookup error ← ${result.provider} ${result.taskId}`, response.body.error);
  return undefined;
}

function onChatProviderChange() {
  fillSelect($("#chat-model"), catalog.chat[$("#chat-provider").value]);
}

async function sendChat() {
  const provider = $("#chat-provider").value;
  const body = { provider, apiKey: keys.get(provider), model: $("#chat-model").value, prompt: $("#chat-prompt").value };
  $("#chat-send").disabled = true;
  $("#chat-status").textContent = "waiting…";
  log.info(`chat request → ${provider}/${body.model}`, { ...body, apiKey: body.apiKey ? "set" : "missing" });
  try {
    const response = await postJson("/api/chat", body);
    const result = response.body;
    $("#chat-output").textContent = result.ok ? result.text : JSON.stringify(result, null, 2);
    (result.ok ? log.ok : log.error)(`chat result ← ${provider}/${body.model}: ${result.stopReason ?? "error"}`, result);
    $("#chat-status").textContent = result.ok ? `ok in ${result.elapsedMs} ms` : "failed (see log)";
  } catch (error) {
    log.error("chat request failed in browser", { message: String(error) });
    $("#chat-status").textContent = "failed (see log)";
  } finally {
    $("#chat-send").disabled = false;
  }
}

$("#image-provider").addEventListener("change", onImageProviderChange);
$("#image-model").addEventListener("change", onImageModelChange);
$("#generate").addEventListener("click", generate);
$("#cancel").addEventListener("click", () => running?.abort());
$("#chat-provider").addEventListener("change", onChatProviderChange);
$("#chat-send").addEventListener("click", sendChat);

try {
  catalog = await getCatalog();
  onImageProviderChange();
  onChatProviderChange();
  log.info("catalogue loaded", {
    image: Object.fromEntries(Object.entries(catalog.image).map(([provider, models]) => [provider, models.map((model) => model.id)])),
    chat: Object.fromEntries(Object.entries(catalog.chat).map(([provider, models]) => [provider, models.map((model) => model.id)])),
  });
} catch (error) {
  log.error("could not load catalogue — is the playground server running?", { message: String(error) });
}
