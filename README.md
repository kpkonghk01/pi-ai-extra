# pi-ai-extra

Server-only extensions to [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) for KIE, ToAPIs and Gemini image generation, plus KIE/ToAPIs chat providers. Three independently installable packages, delivered as GitHub Release `.tgz` files (no npm registry):

| Package | Image models | Chat (pi-ai `Models`) |
| --- | --- | --- |
| `@hk01/pi-ai-extra-kie` | Grok Imagine Image 2.0 (text-to-image, image edit), GPT Image 2 (text-to-image, image-to-image), Nano Banana 2 | GPT Codex (OpenAI Responses), Claude (Anthropic Messages) |
| `@hk01/pi-ai-extra-toapis` | Gemini 3.1 Flash Image (preview), GPT Image 2, GPT Image 2.5 Flare / Sunburst, Seedream 5.0 Pro | Codex (OpenAI Responses), Claude (Anthropic Messages) |
| `@hk01/pi-ai-extra-google` | Gemini 3.1 Flash Image, Gemini 3 Pro Image | — (use pi-ai's built-in `google` provider) |

Each package has two entry points:

| Import | Format | Contents | Needs pi-ai |
| --- | --- | --- | --- |
| `@hk01/pi-ai-extra-<provider>` | CommonJS **and** ESM | `generate<Provider>Image()`, model catalogue, task lookup, errors | No |
| `@hk01/pi-ai-extra-<provider>/pi-ai` | ESM only | pi-ai chat `Provider` and `ImagesProvider` factories | Yes (`@earendil-works/pi-ai@0.87.1`, optional peer) |

The `/pi-ai` subpath is ESM-only because pi-ai itself is ESM-only; a CommonJS server that does not use pi-ai can `require()` the main entry.

Non-negotiable behaviour (see [ADR 0003](docs/adr/0003-explicit-provider-execution.md)):

- API keys are passed explicitly from server-side configuration. The packages never read environment variables and must not be bundled into browser code.
- No provider fallback, model fallback or cross-provider upload. A failure is reported with its `{ provider, model }`.
- Reference-image limits are validated before any request; images are never dropped.

## Install

Install the exact release asset on the server (build) side and pin the full URL:

```sh
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.1.0/hk01-pi-ai-extra-kie-0.1.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.1.0/hk01-pi-ai-extra-toapis-0.1.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.1.0/hk01-pi-ai-extra-google-0.1.0.tgz
```

npm works the same way (`npm install <url>`). Upgrade or roll back by changing the URL. `zod@4.6.5` is installed automatically; install `@earendil-works/pi-ai@0.87.1` only if you use the `/pi-ai` subpath.

## Generate or edit an image

```ts
// CommonJS: const { generateKieImage, isPiAiExtraError } = require("@hk01/pi-ai-extra-kie");
import { generateKieImage, isPiAiExtraError } from "@hk01/pi-ai-extra-kie";

const controller = new AbortController();
try {
  const result = await generateKieImage({
    apiKey: kieApiKey, // from your server-side secret store
    model: "nano-banana-2",
    prompt: "A 16:9 Open Graph cover in Traditional Chinese. Image 1 is the template, image 2 the logo.",
    referenceImages: [templateDataUrl, "https://cdn.example.com/logo.png"],
    aspectRatio: "16:9",
    resolution: "2K",
    signal: controller.signal,
    onProgress: (event) => console.debug(event.type),
  });
  const { dataUrl, mimeType } = result.images[0]!;
} catch (error) {
  if (isPiAiExtraError(error)) {
    // error.provider, error.model, error.code, error.status, error.taskId, error.toJSON()
  }
  throw error;
}
```

`generateToapisImage()` and `generateGoogleImage()` take the same shape. The `model` is the provider's own operation id, and each id has its own validated options:

| Provider | `model` | References | Options |
| --- | --- | --- | --- |
| KIE | `grok-imagine-image-2-0/text-to-image` | 0 | `aspectRatio` (required) |
| KIE | `grok-imagine-image-2-0/image-edit` | 1–5 | `aspectRatio` (required, `auto` allowed) |
| KIE | `gpt-image-2-text-to-image` | 0 | `aspectRatio`, `resolution`, `background` |
| KIE | `gpt-image-2-image-to-image` | 1–16 | `aspectRatio`, `resolution`, `background` |
| KIE | `nano-banana-2` | 0–14 | `aspectRatio`, `resolution`, `outputFormat` |
| ToAPIs | `gemini-3.1-flash-image-preview` | 0–6 | `aspectRatio`, `resolution` |
| ToAPIs | `gpt-image-2` | 0–6 | `aspectRatio`, `resolution`, `background: "transparent"` |
| ToAPIs | `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` | not documented (not capped) | `aspectRatio`, `resolution`, `background: "transparent"` |
| ToAPIs | `doubao-seedream-5-0-pro` | 0–10 (JPEG/PNG) | `aspectRatio`, `resolution` (1K/2K), `watermark` |
| Google | `gemini-3.1-flash-image` | 0–14 | `aspectRatio`, `resolution` (`512`/1K/2K/4K), `safetySettings` |
| Google | `gemini-3-pro-image` | 0–14 | `aspectRatio`, `resolution` (1K/2K/4K), `safetySettings` |

Build UI choices from the exported catalogues (`KIE_IMAGE_MODELS`, `TOAPIS_IMAGE_MODELS`, `GOOGLE_IMAGE_MODELS`): each entry lists supported values, defaults, reference limits, accepted image types and documented cross-field rules. Map your own presets (for example `300x250`) to a supported ratio before calling; unsupported values are rejected, not rewritten.

Reference images are data URLs or public `http(s)` URLs. KIE and ToAPIs upload data URLs through their own upload APIs; Google sends them inline (URLs are downloaded by your server first). Results are downloaded promptly and returned as validated `data:` URLs.

### Options shared by all helpers

| Option | Meaning |
| --- | --- |
| `apiKey` | Required. Explicit provider key. |
| `signal` | Cancels uploads, submission, polling, downloads and waits. |
| `timeoutMs` | Deadline for the task (KIE default 10 min, ToAPIs 6 min, Google 5 min). |
| `onProgress` | `validated`, `upload_*`, `task_submitted`, `task_status`, `download_started`, `completed`, `warning`. A throwing listener is ignored. |
| `maxOutputBytes` | Largest accepted result image (default 50 MiB). |
| `fetch` | Custom fetch for tests or instrumentation. |

Provider settings: KIE `apiBaseUrl`, `uploadBaseUrl`, `poll`; ToAPIs `baseUrl` (for example `https://toapis.cn`), `poll`, `clientBusinessId`; Google `baseUrl`, `headers` (non-credential only, for example `{ "User-Agent": "aistudio-build" }`).

### Errors

Every failure is a `PiAiExtraError` whose message starts with `[provider/model]`. `code` is one of `invalid_request`, `reference_limit`, `invalid_reference`, `auth`, `insufficient_credits`, `rate_limited`, `http`, `network`, `timeout`, `aborted`, `invalid_response`, `upload_failed`, `task_failed`, `content_blocked`, `no_output`, `invalid_output`. Use `isPiAiExtraError()` rather than `instanceof` (it also works across CJS/ESM copies) and `error.toJSON()` for logs.

Only idempotent requests (status polls, downloads, uploads) are retried, against the same URL. Task submission and Gemini generation are never re-sent automatically, because a repeat could be billed twice.

## Usage and billing

`ImageGenerationResult.usage` carries what the provider reported for the task, validated with Zod and never estimated. A field is omitted when the provider did not report it (never filled with `0`); `usage` is `undefined` when nothing was reported.

| Field | KIE | ToAPIs | Google |
| --- | --- | --- | --- |
| `credits` | `creditsConsumed` (number) | `billing.credits` (decimal **string**) | — |
| `costUsd` | — | `billing.cost_usd` (decimal string) | — |
| `billingStatus` | — | `billing.status`: `pending` / `settled` / `refunded` | — |
| `tokens` | — | `usage.*` (input/output/total, text/image, cached) | `usageMetadata` (prompt, candidates, thoughts as `reasoning`, cached, per-modality) |
| `providerDurationMs` | `costTime` (milliseconds per the Get Task Details reference) | — | — |

ToAPIs amounts stay decimal strings: sum them with a decimal library, not floating point. If a usage block has an unexpected shape it is omitted and a `warning` progress event is emitted; the image itself is still returned.

**Record spend per task id, not per observation.** ToAPIs may report `billingStatus: "pending"` even when a task is `completed`; the amount can change or be refunded later. Store one record per `taskId`, replace it with newer lookups, and re-read pending tasks later:

```ts
import { getToapisTask } from "@hk01/pi-ai-extra-toapis";
import { getKieTask } from "@hk01/pi-ai-extra-kie";

const task = await getToapisTask({ apiKey, taskId }); // taskId or the clientBusinessId you sent
if (task.usage?.billingStatus === "settled" || task.usage?.billingStatus === "refunded") {
  await ledger.upsert({ provider: task.provider, taskId: task.taskId, usage: task.usage }); // replace, never add
}
const kie = await getKieTask({ apiKey: kieKey, taskId: kieTaskId }); // state + creditsConsumed/costTime
```

Lookups return failed tasks as a status (`failed` / `fail`) rather than throwing. For ToAPIs, pass `clientBusinessId` (1–128 characters of `A-Z a-z 0-9 . _ : -`, for example `open-graph-single:req-123`) so each task is attributable to an app or request; it is sent as top-level `client_business_id` and can be used as the lookup id.

Through pi-ai, `AssistantImages.usage` is filled only when the provider reported token counts (ToAPIs, Google), following pi-ai's conventions: `input` excludes cached tokens, `cacheRead` holds them, and `output` includes `reasoning`. Credits and USD are available only on the helper result or lookups.

## pi-ai integration (`/pi-ai`, ESM only)

```ts
import { createModels, createImagesModels } from "@earendil-works/pi-ai";
import { createKieProvider, createKieImagesProvider } from "@hk01/pi-ai-extra-kie/pi-ai";
import { createToapisProvider, createToapisImagesProvider } from "@hk01/pi-ai-extra-toapis/pi-ai";
import { createGoogleImagesProvider } from "@hk01/pi-ai-extra-google/pi-ai";

const models = createModels();
models.setProvider(createKieProvider({ apiKey: kieKey }));       // Codex on https://api.kie.ai/api/v1, Claude on https://api.kie.ai/claude (Bearer)
models.setProvider(createToapisProvider({ apiKey: toapisKey })); // Codex on https://toapis.com/v1, Claude on https://toapis.com

const images = createImagesModels();
images.setProvider(createToapisImagesProvider({ apiKey: toapisKey }));
images.setProvider(createGoogleImagesProvider({ apiKey: geminiKey }));

const model = images.getModel("toapis", "gpt-image-2.5-flare")!;
const output = await images.generateImages(
  model,
  { input: [{ type: "text", text: "A lighthouse at dawn" }] },
  { metadata: { aspectRatio: "16:9", resolution: "2K", clientBusinessId: "proxy:app-7" } },
);
// output.stopReason: "stop" | "error" | "aborted"; errors never throw at this layer.
```

pi-ai keeps chat providers (`Models`) and image providers (`ImagesModels`) in separate collections, so each package exports one factory for each. Image options go in `ImagesOptions.metadata` using the helper option names and are validated strictly; unknown keys fail the request rather than being ignored.

Chat models use pi-ai's own OpenAI Responses and Anthropic Messages adapters. Capability metadata (context window, thinking levels) is copied from pi-ai's catalogue when the id matches. `ChatModelDefinition.cost` defaults to `0`, because KIE and ToAPIs prices differ from list prices; set it from your provider's current price sheet if you want pi-ai to compute cost:

```ts
createToapisProvider({
  apiKey: toapisKey,
  // Example numbers only — use USD per million tokens from your current ToAPIs/KIE price sheet.
  models: [{ id: "claude-sonnet-4-6", protocol: "anthropic-messages", cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.9 } }],
});
```

## Google AI Studio (server) integration

1. Put `KIE_API_KEY`, `TOAPIS_API_KEY` and `GEMINI_API_KEY` in the app's server-side Secrets. Never expose them through Vite `define`, client code or a browser request.
2. Add the pinned release URLs to `dependencies` and import the packages only from server modules (for example `server.ts`).
3. Read the secret on the server and pass it as `apiKey`. Forward the request's abort signal so a closed tab cancels the task.
4. Show `{ provider, model, code, message }` to users and in logs. Do not retry through another model or provider automatically.
5. A CommonJS server bundle (`esbuild --format=cjs --packages=external`) can use the main entries. Only the `/pi-ai` subpath needs an ESM server build.

## Playground (not released)

```sh
pnpm install
pnpm playground   # builds the packages, then serves http://127.0.0.1:5178
```

Enter provider keys in the page, then run text-to-image, image-to-image and multi-reference requests, re-query billing by task id, or send a chat smoke test. Every event and error goes to a copyable log with keys redacted. The server binds to 127.0.0.1 only and never stores keys.

## Release

```sh
git tag kie-v0.1.0 && git push origin kie-v0.1.0      # or toapis-vX.Y.Z / google-vX.Y.Z
```

The workflow checks that the tag matches the package version, runs check/test/build for the package and its internal dependency, packs the `.tgz`, and attaches it to a GitHub Release using `GITHUB_TOKEN`. Never replace an asset that consumers use; publish a new patch version instead ([ADR 0001](docs/adr/0001-registry-free-package-releases.md)).

## Development

```sh
pnpm install --ignore-scripts
pnpm run check   # TypeScript 7 (tsc --noEmit)
pnpm run test    # node:test contract tests with a fake fetch, no network
pnpm run build   # tsdown: dual CJS/ESM + declarations (oxc isolated declarations)
pnpm run pack:kie && pnpm run pack:toapis && pnpm run pack:google   # → release-artifacts/
```

Exported declarations need explicit types (`isolatedDeclarations`). Provider contracts are in [`referenc-docs/`](referenc-docs/); check them before adding or changing a model operation. Wokey is intentionally excluded.
