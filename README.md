# pi-ai-extra

Server-only extensions to [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) for KIE, ToAPIs and Gemini image generation, plus KIE, ToAPIs, Gemini and OpenRouter chat providers. Four independently installable provider packages (KIE, ToAPIs, Google, OpenRouter), delivered as GitHub Release `.tgz` files (no npm registry), for Node.js 24.22.1 or later:

| Package | Image models | Chat (pi-ai `Models`) |
| --- | --- | --- |
| `@hk01/pi-ai-extra-kie` | Grok Imagine Image 2.0 (text-to-image, image edit), GPT Image 2 (text-to-image, image-to-image), Nano Banana 2 | Codex (OpenAI Responses), Claude (Anthropic Messages) |
| `@hk01/pi-ai-extra-toapis` | Gemini 3.1 Flash Image (preview), GPT Image 2, GPT Image 2.5 Flare / Sunburst, Seedream 5.0 Pro | Codex (OpenAI Responses), Claude (Anthropic Messages) |
| `@hk01/pi-ai-extra-google` | Gemini 3.1 Flash Image, Gemini 3 Pro Image | Gemini (pi-ai's Gemini adapter and catalogue, explicit key) |
| `@hk01/pi-ai-extra-openrouter` | None (pi-ai already serves OpenRouter's image generation) | OpenAI Completions, Anthropic Messages (pi-ai's OpenRouter provider, explicit key, live model list) |

Each package has two entry points (OpenRouter's has only the second):

| Import | Format | Contents | Needs pi-ai |
| --- | --- | --- | --- |
| `@hk01/pi-ai-extra-<provider>` | CommonJS **and** ESM | `generate<Provider>Image()`, model catalogue, task lookup, errors | No |
| `@hk01/pi-ai-extra-<provider>/pi-ai` | ESM only | pi-ai `Provider` factory serving the chat and image models | Yes (`@earendil-works/pi-ai@1.2.0`, optional peer) |

The `/pi-ai` subpath is ESM-only because pi-ai itself is ESM-only; a CommonJS server that does not use pi-ai can `require()` the main entry. `@hk01/pi-ai-extra-openrouter` has only the `/pi-ai` entry, and needs pi-ai (a required, exact peer), because pi-ai already serves OpenRouter's images and there is no helper for a main entry to hold ([ADR 0004](docs/adr/0004-dual-format-helper-esm-pi-ai-subpath.md)).

Two kits sit on top of the provider packages. The image kit, [`@hk01/pi-ai-extra-image-kit`](packages/image-kit/README.md), is the image client for Google AI Studio apps built on the three image provider packages (KIE, ToAPIs, Google; their peer dependencies): model families derived from the installed catalogues through an app-owned, route-scoped catalogue policy, request validation, NDJSON streaming, a browser reader and React UI (model selector, error panel). Only its `/server` entry imports the provider packages; its `/browser` and `/react` entries run in the browser and never hold keys or provider code ([ADR 0006](docs/adr/0006-image-kit-package.md), [ADR 0007](docs/adr/0007-catalogue-policy-model-selection.md)).

The chat kit, [`@hk01/pi-ai-extra-chat-kit`](#chat-kit), runs one chat turn the same way on the chat providers you register (Gemini, OpenRouter, KIE, ToAPIs): it takes pi-ai's `Context` and streams pi-ai's events, adds documents, a response schema, safety blocks, usage and cost, and lists each provider's live models, for a server-side gateway with no per-provider code. It is ESM-only and server-only ([ADR 0008](docs/adr/0008-chat-kit-package.md), [ADR 0009](docs/adr/0009-chat-kit-contract-aligned-with-pi-ai.md)).

Non-negotiable behaviour (see [ADR 0003](docs/adr/0003-explicit-provider-execution.md)):

- API keys are passed explicitly from server-side configuration. The packages never read environment variables and must not be bundled into browser code.
- No provider fallback, model fallback or cross-provider upload. A failure is reported with its `{ provider, model }`.
- Reference-image limits are validated before any request; images are never dropped.

## Install

Install the exact release asset on the server (build) side and pin the full URL:

```sh
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.5.0/hk01-pi-ai-extra-kie-0.5.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.5.0/hk01-pi-ai-extra-toapis-0.5.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.6.0/hk01-pi-ai-extra-google-0.6.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/openrouter-v0.1.0/hk01-pi-ai-extra-openrouter-0.1.0.tgz   # optional, chat only, needs pi-ai
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz   # optional, needs all three
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/chat-kit-v0.3.0/hk01-pi-ai-extra-chat-kit-0.3.0.tgz     # optional, needs pi-ai and the providers you register
```

npm works the same way (`npm install <url>`). Upgrade or roll back by changing the URL. `zod@4.6.5` is installed automatically; install `@earendil-works/pi-ai@1.2.0` only if you use the `/pi-ai` subpath.

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
| Google | `gemini-3.1-flash-image` | 0–14 | `aspectRatio`, `resolution` (`512`/1K/2K/4K), `safetySettings`, `temperature` (0–2), `systemInstruction` |
| Google | `gemini-3-pro-image` | 0–14 | `aspectRatio`, `resolution` (1K/2K/4K), `safetySettings`, `temperature` (0–2), `systemInstruction` |

Build UI choices from the exported catalogues (`KIE_IMAGE_MODELS`, `TOAPIS_IMAGE_MODELS`, `GOOGLE_IMAGE_MODELS`): each entry lists supported values, defaults, reference limits, accepted image types and documented cross-field rules. Map your own presets (for example `300x250`) to a supported ratio before calling; unsupported values are rejected, not rewritten.

Each entry also declares its model family: `familyId`, `familyName` and `operationRole` (`unified`, `text-to-image` or `image-to-image`). Operations with the same `familyId` are one user-facing model; for example KIE `gpt-image-2-text-to-image` and `gpt-image-2-image-to-image` form family `gpt-image-2`. Use the role to pick the operation from whether a request has reference images, rather than parsing model IDs.

Two catalogue fields appear only on models that accept them: `temperature` (the accepted `{ min, max }` range) and `systemInstruction` (`true`). Only the Google models list them; KIE and ToAPIs document neither, so their models omit both and reject them with `invalid_request`. Use the fields to enable or disable the matching UI controls.

Reference images are data URLs or public `http(s)` URLs. KIE and ToAPIs upload data URLs through their own upload APIs; Google sends them inline (URLs are downloaded by your server first). Results are downloaded promptly and returned as validated `data:` URLs.

### Options shared by all helpers

| Option | Meaning |
| --- | --- |
| `apiKey` | Required. Explicit provider key. |
| `signal` | Cancels uploads, submission, polling, downloads and waits. |
| `timeoutMs` | Deadline for the task (KIE default 10 min, ToAPIs 6 min, Google 5 min). |
| `onProgress` | `validated`, `upload_started` / `upload_completed`, `task_submitted`, `task_status` (KIE, ToAPIs), `request_sent` (Google), `download_started`, `completed`, `warning`. A throwing listener is ignored. |
| `maxOutputBytes` | Largest accepted result image (default 50 MiB). |
| `fetch` | Custom fetch for tests or instrumentation. |

Provider settings: KIE `apiBaseUrl`, `uploadBaseUrl`, `poll`; ToAPIs `baseUrl` (for example `https://toapis.cn`), `poll`, `clientBusinessId`; Google `baseUrl`, `headers` (non-credential only, for example `{ "User-Agent": "aistudio-build" }`).

An option set to `undefined` counts as not set, so optional fields can be passed unconditionally. Any other unknown or misspelled key (for example `aspect_ratio`) is rejected with `invalid_request` instead of being ignored.

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

`tokens` may contain `input`, `output`, `total`, `inputText`, `inputImage`, `cachedInput`, `cachedInputText`, `cachedInputImage`, `outputText`, `outputImage`, `reasoning` (Gemini thoughts, not included in `output`) and `toolUsePrompt`; `input` includes cached tokens. `result.taskId` is the provider task id for KIE and ToAPIs, and Gemini's `responseId` for Google (Gemini has no task to look up later).

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

Lookups return failed tasks as a status (`failed` / `fail`) rather than throwing, and still return billing when a finished task's result URLs have expired (pass `onProgress` to receive the `warning`). For ToAPIs, pass a unique `clientBusinessId` per request (non-empty, at most 128 characters, no control characters or surrounding whitespace; for example `open-graph-single:3f1c…`) so each task is attributable to an app or request; it is sent as top-level `client_business_id` and can be used as the lookup id.

Through pi-ai, `AssistantImages.usage` is filled only when the provider reported input or output token counts (ToAPIs, Google; never KIE), following pi-ai's conventions: `input` excludes cached tokens, `cacheRead` holds them, and `output` includes `reasoning`. Credits and USD are available only on the helper result or lookups.

## pi-ai integration (`/pi-ai`, ESM only)

```ts
import { createModels } from "@earendil-works/pi-ai";
import { createKieProvider } from "@hk01/pi-ai-extra-kie/pi-ai";
import { createToapisProvider } from "@hk01/pi-ai-extra-toapis/pi-ai";
import { createGoogleProvider } from "@hk01/pi-ai-extra-google/pi-ai";

const models = createModels();
models.setProvider(createKieProvider({ apiKey: kieKey }));       // Codex on https://api.kie.ai/openai/v1, Claude on https://api.kie.ai/anthropic (Bearer)
models.setProvider(createToapisProvider({ apiKey: toapisKey })); // Codex on https://toapis.com/v1, Claude on https://toapis.com
models.setProvider(createGoogleProvider({ apiKey: geminiKey }));  // Gemini chat; never reads GEMINI_API_KEY

const chat = models.getModel("toapis", "claude-sonnet-4-6")!;        // chat models only
const image = models.getModelOfType("image", "toapis", "gpt-image-2.5-flare")!;
const output = await models.generateImages(
  image,
  { input: [{ type: "text", text: "A lighthouse at dawn" }] },
  { metadata: { aspectRatio: "16:9", resolution: "2K", clientBusinessId: `proxy:app-7:${crypto.randomUUID()}` } },
);
// output.stopReason: "stop" | "error" | "aborted"; errors never throw at this layer.
```

pi-ai 1.2 keeps chat and image models in one `Models` collection, so each package exports one factory, `create<Provider>Provider()`, which registers its chat models and its image catalogue (`KIE_IMAGE_MODELS`, `TOAPIS_IMAGE_MODELS`, `GOOGLE_IMAGE_MODELS`) under one provider id (`kie`, `toapis`, `google`) with one explicit key. `getModels()` and `getModel()` return chat models only; look image models up with `getModelOfType("image", provider, id)` or `getModelsOfType("image", provider)`, and run them with `models.generateImages()`. Image helper settings (for example a poll cadence, KIE `uploadBaseUrl` or ToAPIs `clientBusinessId`) go in the factory's `imageSettings`; the image host is set there, independently of the chat base URL. Image options go in `ImagesOptions.metadata` using the helper option names and are validated strictly; unknown keys fail the request rather than being ignored. pi-ai's `ImagesContext` has no system prompt and `ImagesOptions` no temperature, so Google's `temperature` and `systemInstruction` also go in `metadata`.

`createGoogleProvider({ apiKey, modelIds?, baseUrl?, imageSettings? })` serves pi-ai's own Gemini adapter and model catalogue (`GOOGLE_CHAT_MODEL_IDS`), but authenticates only with the explicit key: unlike pi-ai's `googleProvider()`, it never reads `GEMINI_API_KEY`. `modelIds` restricts the chat list; unknown ids throw. A model in the Gemini rate table (`GEMINI_CHAT_RATES`, see [Chat rates](#chat-rates)) gets its `cost` from that schedule; every other model keeps pi-ai's list price.

KIE and ToAPIs chat models use pi-ai's own OpenAI Responses and Anthropic Messages adapters. Capability metadata (context window, thinking levels) is copied from pi-ai's catalogue when the id, or `ChatModelDefinition.catalogueId`, matches; KIE's dashed Codex ids (`gpt-5-6-sol`) point at pi-ai's dotted ones (`gpt-5.6-sol`). Prices are never copied from pi-ai's catalogue, because KIE and ToAPIs prices differ from list prices.

### Chat rates

Every chat model has a **rate**: its provider's published per-token prices, in USD per 1M tokens, as a dated schedule (the glossary's [Model rate](CONTEXT.md#model-rate)). A model whose rate is not published has no rate, never a zero rate.

```ts
import type { ModelRate } from "@hk01/pi-ai-extra-kie/pi-ai"; // also exported by the ToAPIs and Google /pi-ai entries and the chat kit

const rate: ModelRate = {
  periods: [
    { input: 0.75, output: 3.75, cacheRead: 0.075 },                     // from the beginning
    { from: "2027-01-01", input: 1.5, output: 7.5, cacheRead: 0.15 },    // from 00:00 UTC on that day
  ],
};
// A large-prompt tier prices the whole request when its prompt is over the threshold:
// { input: 2, output: 12, cacheRead: 0.2, largePrompt: { overPromptTokens: 200_000, input: 4, output: 18, cacheRead: 0.4 } }
```

- A period applies from its `from` day (UTC, `YYYY-MM-DD`). Only the first period may omit it; when it does not, the model has no rate before that day. A price change announced ahead of time is published ahead of time, and a request is priced at the period in force when it was made.
- A cache rate the provider does not publish is left out, and derived when a request is priced: cache reads at the input rate, an upper bound, and cache writes at 1.25 × input, the price of a 5-minute write on Anthropic and in KIE's own Codex rows. A 1-hour write (`cacheRetention: "long"`) costs 2 × input on Anthropic.
- pi-ai's `Model.cost` is required, so each provider fills it from the period in force when the provider is created, with the derived cache rates and the large-prompt tier as a pi-ai cost tier. pi-ai's `message.usage.cost` is pi-ai's calculation from token counts and that period, not a provider-reported charge. A model with no rate carries zeros in `Model.cost`, which are not a rate. The [chat kit](#usage-and-cost) prices each turn from the schedule itself, at call time.
- An invalid schedule (no period, a later period without `from`, dates out of order, a negative rate) throws a `TypeError` when the provider is created.

`KIE_CHAT_MODELS` and `TOAPIS_CHAT_MODELS` carry each model's `rate` as one period: neither provider publishes dates. Rates as of 2026-10-16:

| Provider | Model | Input | Output | Cache read | Cache write |
| --- | --- | ---: | ---: | ---: | ---: |
| KIE | `gpt-6-1-sol` | 0.60 | 3.00 | 0.03 | 0.75 |
| KIE | `gpt-6-astra` | 2.80 | 14.00 | 0.28 | 3.50 |
| KIE | `gpt-6-sol` | 0.60 | 3.00 | 0.06 | 0.75 |
| KIE | `gpt-6-luna` | 0.03 | 0.15 | 0.003 | 0.0375 |
| KIE | `gpt-5-6-sol` | 1.40 | 8.40 | 0.14 | 1.75 |
| KIE | `gpt-5-6-terra` | 0.56 | 3.36 | 0.056 | 0.70 |
| KIE | `gpt-5-6-luna` | 0.056 | 0.336 | 0.0056 | 0.07 |
| KIE | `claude-opus-5-5` | 1.60 | 8.00 | 1.60* | 2.00† |
| KIE | `claude-sonnet-5-5` | 0.80 | 4.00 | 0.80* | 1.00† |
| KIE | `claude-haiku-5-5` | 0.06 | 0.30 | 0.06* | 0.075† |
| KIE | `claude-fable-5` | 4.00 | 20.00 | 4.00* | 5.00† |
| KIE | `claude-opus-5`, `claude-opus-4-8` | 2.00 | 10.00 | 2.00* | 2.50† |
| KIE | `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5` | 1.425 | 7.15 | 1.425* | 1.78125† |
| KIE | `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5` | 0.85 | 4.275 | 0.85* | 1.0625† |
| KIE | `claude-haiku-4-5` | 0.275 | 1.425 | 0.275* | 0.34375† |
| ToAPIs | `gpt-5.3-codex-official` | 1.40 | 11.20 | 1.40* | 1.75† |
| ToAPIs | `claude-opus-4-6` | 1.50 | 7.50 | 1.50* | 1.875† |
| ToAPIs | `claude-sonnet-4-6` | 0.90 | 4.50 | 0.90* | 1.125† |
| ToAPIs | `claude-haiku-4-5` | 0.30 | 1.50 | 0.30* | 0.375† |

- **KIE**: [kie.ai/pricing](https://kie.ai/pricing), read from `POST https://api.kie.ai/client/v1/model-pricing/page` with `{"pageNum":1,"pageSize":100,"interfaceType":"chat"}`. KIE prices chat in credits per 1M tokens, and 1 credit is $0.005, exported as `KIE_USD_PER_CREDIT` (for example `claude-sonnet-4-6`: 170 credits in, 855 out).
- **ToAPIs**: `GET https://toapis.com/api/pricing`. Input is 2 × `model_ratio` and output is 2 × `model_ratio` × `completion_ratio` (every group ratio is 1).
- \* Cache read and † cache write not published: derived as described above.

`GEMINI_CHAT_RATES` (`@hk01/pi-ai-extra-google/pi-ai`) is the Gemini text-model schedule: Standard tier, paid, text, image and video input, output including thinking, from [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) as of 2026-10-16. Cached input is Google's "Caching" price. Gemini publishes no per-token cache-write price and reports no cache-write tokens.

| Model | Input | Output | Cached input | From 2027-01-01 (input / output / cached) |
| --- | ---: | ---: | ---: | --- |
| `gemini-3.8-flash`, `gemini-3.6-flash` | 0.75 | 3.75 | 0.075 | 1.50 / 7.50 / 0.15 |
| `gemini-3.7-flash` | 0.75 | 3.75 | — | 1.50 / 7.50 / — |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | 0.03 | |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | 0.025 | |
| `gemini-3.1-pro-preview` | 2.00 (4.00 over 200k) | 12.00 (18.00) | 0.20 (0.40) | |

`googleChatRate(id)` looks a model up. A `-preview` id the table does not list takes the rate of the id without the suffix: the API has served `-preview` ids for models the price page lists without it. An id outside the table takes pi-ai's catalogue list price for that id, as one period, where a zero price is no rate. Any other id has no rate. 3.7 Flash is no longer on Google's page; its rates are the portal's, and its cached input, with no published rate, is derived as described above.

Only models with a published rate are in the KIE and ToAPIs default lists. ToAPIs also documents `gpt-5.3-codex` and `gpt-5.3-codex-spark` as chat models, but they have no published price and are not in its public model catalogue, so `TOAPIS_CHAT_MODELS` leaves them out. To use one anyway, pass it in the factory's `models` option. Without a `rate` it has no rate: the chat kit reports no cost for it, and pi-ai's `usage.cost` for it is zero but is not a cost:

```ts
createToapisProvider({ apiKey: toapisKey, models: [...TOAPIS_CHAT_MODELS, { id: "gpt-5.3-codex", protocol: "openai-responses" }] });
```

Prices change. To use your own rate, replace the model's `rate` and keep the rest of the list:

```ts
import { createToapisProvider, TOAPIS_CHAT_MODELS } from "@hk01/pi-ai-extra-toapis/pi-ai";

createToapisProvider({
  apiKey: toapisKey,
  // Your own rates in USD per 1M tokens, for example a negotiated price.
  models: TOAPIS_CHAT_MODELS.map((model) =>
    model.id === "claude-sonnet-4-6" ? { ...model, rate: { periods: [{ input: 0.9, output: 4.5, cacheRead: 0.09, cacheWrite: 1.125 }] } } : model,
  ),
});
```

### Upgrading to KIE/ToAPIs 0.4 and Google 0.5

| Before (KIE/ToAPIs 0.3, Google 0.4) | Now |
| --- | --- |
| `ChatModelDefinition.cost: { input, output, cacheRead, cacheWrite }` | `ChatModelDefinition.rate: { periods: [{ from?, input, output, cacheRead?, cacheWrite?, largePrompt? }] }` |
| A definition without `cost` priced at 0 | A definition without `rate` has no rate (pi-ai's `Model.cost` holds zeros, which are not a rate) |
| Gemini models at pi-ai's list prices | Models in `GEMINI_CHAT_RATES` at its schedule, including the 2027-01-01 doubling |

KIE adds `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `gpt-6-sol`, `gpt-6-luna` and `gpt-6-1-sol`, and exports its credit price as `KIE_USD_PER_CREDIT`. The rate types (`ModelRate`, `RatePeriod`, `TokenRates`, `LargePromptRates`) are exported by each `/pi-ai` entry.

### Upgrading to KIE/ToAPIs 0.5 and Google 0.6

The `/pi-ai` factories (`createKieProvider`, `createToapisProvider`, `createGoogleProvider`) now return a chat provider: a pi-ai `Provider` with a `chatKit` member (what the provider takes, which models it offers, model rates and its cost policy) and a live model list as `refreshModels`, which replaces the chat models, so `models.refresh()` reads it for any pi-ai consumer. Plain pi-ai code ignores `chatKit`. The change is additive: new `fetch` option on all three (it serves the model list, and on KIE and ToAPIs chat requests too, where a request's own `fetch` wins; Google's chat requests always use the global fetch, because pi-ai's Gemini adapter rejects a custom one), and `grounding` on Google (Google Search and URL context on every chat request, and a prompt Gemini blocks ends with its block reason as `rawStopReason`). The rate types and `ChatProvider` / `ChatProviderTraits` are exported by each `/pi-ai` entry. `@hk01/pi-ai-extra-openrouter` 0.1.0 is new: `createOpenRouterProvider({ apiKey, baseUrl?, fetch? })` extends pi-ai's `openrouterProvider()` with an explicit key and a live list, and has a `/pi-ai` entry only.

### Upgrading from KIE/ToAPIs 0.2 and Google 0.3

pi-ai 1.2 removed `createImagesModels()`, `createImagesProvider()`, `ImagesProvider` and `ImagesModel`, so the separate image factories are gone:

| Before (pi-ai 0.87.1) | Now (pi-ai 1.2.0) |
| --- | --- |
| `@earendil-works/pi-ai@0.87.1` | `@earendil-works/pi-ai@1.2.0` |
| `createKieImagesProvider({ apiKey, settings })` (likewise ToAPIs, Google) | `createKieProvider({ apiKey, imageSettings: settings })`, the same provider as chat |
| `createImagesModels()` | `createModels()`, the same collection as chat |
| `images.getModel("kie", id)` | `models.getModelOfType("image", "kie", id)` |
| `images.generateImages(model, context, options)` | `models.generateImages(model, context, options)` (same context, options and result) |

Register each package's provider once: a second provider with the same id replaces the first in a `Models` collection.

`KIE_CHAT_MODELS` and `TOAPIS_CHAT_MODELS` now carry published rates instead of zero cost (since 0.4, as a dated `rate`; see [Chat rates](#chat-rates)). ToAPIs Claude Haiku is `claude-haiku-4-5`, the public catalogue id, instead of `claude-haiku-4-5-20251001`. ToAPIs `gpt-5.3-codex` and `gpt-5.3-codex-spark` are no longer in the default list, because they have no published rate; pass them in `models` to keep using them.

KIE chat defaults changed as well. Codex moved to `https://api.kie.ai/openai/v1` (`POST /openai/v1/responses`, the route in KIE's Codex CLI guide, which returns real HTTP statuses) and now offers `gpt-6-astra`, `gpt-5-6-sol`, `gpt-5-6-terra` and `gpt-5-6-luna`; the `gpt-5.x-codex` ids are delisted, and `gpt-5-5` is left out because KIE rejects it for Codex. `responsesBaseUrl: "https://api.kie.ai/codex/v1"` selects the API reference's route instead. Claude uses `https://api.kie.ai/anthropic`, the base URL in KIE's Claude Code guides; the model pages still show `/claude/v1/messages`, which `claudeBaseUrl: "https://api.kie.ai/claude"` keeps.

### Prompt caching

Chat requests go through pi-ai's adapters unchanged, so caching is controlled by pi-ai's `cacheRetention` (`"none"`, `"short"` (default) or `"long"`) and `sessionId` options:

```ts
await models.complete(model, context, { cacheRetention: "short", sessionId: `og-single:${userId}` });
// message.usage.cacheRead shows the tokens served from cache
```

| Route | What pi-ai sends | Provider documentation |
| --- | --- | --- |
| KIE / ToAPIs Claude (Messages) | `cache_control: {type: "ephemeral"}` by default; `"long"` adds `ttl: "1h"` | KIE reports cache tokens in responses but documents no `cache_control`; ToAPIs does not mention caching |
| KIE / ToAPIs Codex (Responses) | `prompt_cache_key` when `sessionId` is set; `"long"` adds `prompt_cache_retention: "24h"`, or `prompt_cache_options: {ttl: "30m"}` for models pi-ai marks as explicit-cache capable (GPT-5.6 and GPT-6), where `"none"` sends `prompt_cache_options: {mode: "explicit"}` | Not mentioned by either |
| Gemini chat | Nothing: Gemini 2.5+ caches implicitly (prompts of about 2,048–4,096 tokens or more); explicit `cachedContents` is not supported by pi-ai's Gemini adapter | Implicit caching is automatic |
| Image helpers | Nothing | No caching parameters |

Pass `cacheRetention` explicitly: when it is omitted, pi-ai falls back to the `PI_CACHE_RETENTION` environment variable. Prefer `"short"` with KIE/ToAPIs Codex until `"long"` has been verified against the gateway.

## Chat kit

`@hk01/pi-ai-extra-chat-kit` is the server-side chat counterpart of the image kit ([ADR 0008](docs/adr/0008-chat-kit-package.md), [ADR 0009](docs/adr/0009-chat-kit-contract-aligned-with-pi-ai.md)). It registers the chat providers a consumer builds with the provider packages' factories, offers one interface for calling LLMs, and routes each call by its model reference to the matching provider. It extends pi-ai instead of replacing it: a turn takes pi-ai's `Context` and option names and streams pi-ai's events, and the kit adds what pi-ai lacks (reference documents, a response schema, safety-block reporting, a usage record with its cost), filled in per wire API. It is ESM-only (like pi-ai) and server-only. It never chooses a provider and never falls back ([ADR 0003](docs/adr/0003-explicit-provider-execution.md)).

### Install

```sh
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/chat-kit-v0.3.0/hk01-pi-ai-extra-chat-kit-0.3.0.tgz
pnpm add @earendil-works/pi-ai@1.2.0   # peer, with the provider packages you use (google 0.6+, openrouter 0.1+, kie and toapis 0.5+)
```

### Chat providers and `createChatKit`

A chat provider is a pi-ai `Provider` with the kit's traits under `chatKit`. Each provider package's `/pi-ai` factory builds one with an explicit key:

```ts
import { createChatKit } from "@hk01/pi-ai-extra-chat-kit";
import { createGoogleProvider } from "@hk01/pi-ai-extra-google/pi-ai";
import { createOpenRouterProvider } from "@hk01/pi-ai-extra-openrouter/pi-ai";
import { createKieProvider } from "@hk01/pi-ai-extra-kie/pi-ai";

const chat = createChatKit({
  providers: [
    createGoogleProvider({ apiKey: geminiKey, grounding: true }),
    createOpenRouterProvider({ apiKey: openRouterKey }),
    createKieProvider({ apiKey: kieKey }),
  ],
});
```

| Factory | Provider id | Options beyond `apiKey` | PDF and image documents | Tools |
| --- | --- | --- | --- | --- |
| `createGoogleProvider` | `google` | `grounding`, `baseUrl`, `modelIds`, `fetch` | Yes | Yes |
| `createOpenRouterProvider` (`@hk01/pi-ai-extra-openrouter`) | `openrouter` | `baseUrl`, `fetch` | Yes | Yes |
| `createKieProvider` | `kie` | `responsesBaseUrl`, `claudeBaseUrl`, `models`, `fetch` | Not yet | Not yet |
| `createToapisProvider` | `toapis` | `baseUrl`, `models`, `fetch` | Not yet | Not yet |

- The kit knows a provider by its pi-ai id (`provider.id`). A name a consumer gives a provider (for example the portal's `gemini` for `google`) is the consumer's own: it maps the name before calling the kit, and keeps its own table from configuration to factories.
- Every key goes to a factory, so the kit never handles one. Each provider resolves only the key its factory bound: the kit registers them in a pi-ai `Models` collection with an empty auth context, so nothing reads `GEMINI_API_KEY`, `OPENROUTER_API_KEY` or any other environment variable.
- **One kit per tenant.** A chat provider binds one key, so two keys for the same provider are two kits. A multi-tenant service creates a kit per tenant; a kit holds no timers between calls, so it needs no `dispose()`.
- `createChatKit` throws a `TypeError` for a value that is not a chat provider (no `chatKit` traits, for example a provider from an older package), for two providers with the same id, and for an invalid `fetch`.
- `fetch` (optional) is for tests or instrumentation: every turn's requests use it instead of the provider's own, except Gemini's, whose pi-ai adapter rejects a custom fetch. Model lists use each factory's `fetch` option.

### Turns: `streamSimple` and `completeSimple`

```ts
const stream = chat.streamSimple(
  { provider: "google", id: "gemini-3.5-flash" }, // a pi-ai Model is a valid reference too
  { systemPrompt: gem.instructions, messages: [...history, { role: "user", content: userMessage, timestamp: Date.now() }] }, // pi-ai's Context
  {
    documents: gem.files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      url: file.publicUrl, // optional: the provider fetches the file itself (keep it stable for caching)
      size: file.bytes, // optional: Gemini fetches by URL only when the size is known to be at most 15 MB
      load: () => blobStore.read(file.key), // called only when the bytes must be sent
    })),
    responseSchema: { name: "reply", schema: replyJsonSchema }, // optional: the answer streams as JSON text
    temperature: 0.7,
    maxTokens: 2048,
    reasoning: "low",
    signal: abortController.signal,
  },
);
for await (const event of stream) if (event.type === "text_delta") res.write(event.delta);
const message = await stream.result(); // pi-ai's AssistantMessage, with the kit's record under message.chatKit
if (message.stopReason === "error") showError(message.chatKit.error.code, message.rawStopReason);
else await usageLog.record(message.chatKit.usage); // undefined if the provider reported none
```

`completeSimple()` is `streamSimple(...).result()`. Both mirror pi-ai's `Models.streamSimple()` and `completeSimple()` and never throw: a failure arrives as the final `error` event and a `stopReason: "error"` message.

- **Reference.** `{ provider, id }`: the pi-ai provider id and the provider's model id. It must be in the provider's list (see [`listModels`](#listmodels)); otherwise the turn fails with `UNKNOWN_MODEL`.
- **Context.** pi-ai's `Context`, unextended: `systemPrompt`, `messages`, and `tools`. Documents go in an option and open the first user message, so provider prompt caching covers them (see [Prompt layout and caching](#prompt-layout-and-caching)).
- **Options.** pi-ai's names: `temperature`, `maxTokens`, `reasoning` (`ThinkingLevel`; omitted means thinking off where the model allows), `signal`, `sessionId`, `maxRetries` (default 2; only the initial request is retried), and `toolChoice` (`"auto"` or `"none"`), plus the kit's `documents` and `responseSchema`. Every optional member also accepts `undefined`, for `exactOptionalPropertyTypes`. Unknown keys are rejected with `INVALID_REQUEST`.
- **Events.** pi-ai's, passed through: `start`, `text_*`, `thinking_*`, `toolcall_*`, then `done` or `error`. A failure the kit finds before sending is a lone `error` event with no `start`, as pi-ai's `lazyStream` ends a setup failure. A response schema on Anthropic Messages is a forced tool call, which the kit turns into `text_*` events, a text block and `stopReason: "stop"`: free text the model wrote beside the call is dropped, so every `contentIndex` and partial matches the final message, and a call without argument deltas streams `{}` as one `text_delta`.
- **Final message.** pi-ai's `AssistantMessage`: `provider`, `api` and `model` are the model's own (so pi-ai replays thinking only for the same model; `api` is `"unknown"` when no model resolved), `errorMessage` starts with `[provider/model]`, and `rawStopReason` holds the provider's own stop or block reason. `message.usage` stays pi-ai's zero-filled usage. The message goes back into `Context.messages` unchanged: pi-ai's adapters ignore `chatKit`. An answer cut off at `maxTokens` ends `stopReason: "length"` (the text is the whole, cut-off answer); with a `responseSchema` it fails instead, with `PROVIDER_ERROR`, because cut-off JSON cannot be parsed. An abort is `stopReason: "aborted"`, without an error.

**Which overload.** A Gem turn takes a tool-free context (`ChatToolFreeContext`) and an optional `responseSchema`; an agent turn takes a context that may have `tools` and no schema. Tools and a schema are mutually exclusive, in the types and at run time: a turn with both, from `tools`, from a transcript's `toolsAdded` or from an untyped caller, fails with `INVALID_REQUEST` before anything is sent. An empty `tools` array counts as none. Tools, tool calls and tool results pass through to pi-ai; the kit refuses them with `UNSUPPORTED` only for a provider not yet verified live (KIE, ToAPIs) or a model without tool support. An image in the context on a model without image input fails with `UNSUPPORTED` too, where pi-ai would replace it with placeholder text.

### `listModels`

```ts
for (const entry of await chat.listModels({ signal })) {
  if ("error" in entry) showError(entry.provider, entry.error);   // this provider could not be listed at all
  else render(entry.provider, entry.models, entry.refreshError);   // refreshError: the latest refresh failed, models are still usable
}
// entry.models[i]: a pi-ai Model, plus model.chatKit: { fileInput, fileDocuments, tools, responseSchema, rate? }
```

`listModels()` returns one entry per registered provider, in registration order: `{ provider, source, fetchedAt?, refreshError?, models }`, or `{ provider, error }` when the list could not be produced at all. One failing provider never hides the others. Each model is a pi-ai `Model` (`id`, `name`, `api`, `input`, `contextWindow`, `maxTokens`, `reasoning`, `cost`, …) and is also a valid reference for a turn. Thinking levels come from pi-ai's `getSupportedThinkingLevels(model)`.

Each provider's live list is its own `refreshModels`, so `models.refresh()` reads it for any pi-ai consumer. It replaces the provider's chat models, so a model the provider drops disappears (pi-ai's `createProvider({ fetchModels })` would merge over the baseline and never remove one):

| Provider | Live list | Kept |
| --- | --- | --- |
| `openrouter` | Public `GET <root>/v1/models` (no key) | Every model that answers in text, tool support or not. The kit offers all but the [excluded models](#excluded-models) |
| `google` | `models.list` (`GET <base>/models`) with the key | `generateContent` models, `models/` prefix stripped; narrowed to `modelIds` when set. The kit offers plain text chat models only: not embedding, Imagen, Veo, TTS, Live (`-live-`), computer use or Deep Research models, and not the [excluded models](#excluded-models) |
| `kie` | `GET <responsesBaseUrl>/models` (Codex) and `GET <claudeBaseUrl>/v1/models` (Claude) with the key | Only ids with a package definition (`KIE_CHAT_MODELS`), matched across `.` and `-` spellings |
| `toapis` | `GET <host>/v1/models?type=text` with the key | Only ids with a package definition (`TOAPIS_CHAT_MODELS`) |

- **Refresh.** While no live list has been read, `listModels()` and turns read it and wait for it. A live list is fresh for 30 minutes. After that, `listModels()` and turns answer from it at once and read it again in the background; the calls after that read see the new list, and no call waits for it. A failed refresh keeps the last good list (`source: "live"`), or uses the installed catalogue or definitions when no live list has been read (`source: "installed"`), and reports why in `refreshError`; the next attempt waits a minute. Concurrent callers share one refresh. Aborting `signal` makes `listModels()` reject with its reason; the refresh itself completes for the others.
- **Deadlines.** A list read has one deadline for all its requests and pages (KIE's two lists, every Gemini page), never one per request: 5 seconds while no live list has been read, since calls wait for that read, and 15 seconds for the background refresh of a stale list, which no call waits for.
- **Turns use the same list.** A turn resolves its reference against the list `listModels()` would return, so a model only the live list has works, and a model the live list no longer has fails with `UNKNOWN_MODEL` once a read has dropped it. The trade-off of not waiting: the call that finds the list 30 minutes old, and any call before its refresh lands (within 15 seconds), still resolves against the old list, so a model the provider has dropped may be sent once more; the provider then answers with its own error (`PROVIDER_ERROR`).
- **OpenRouter models** are built the way pi-ai's own catalogue generator builds them. A model pi-ai's catalogue knows keeps that entry (its API, compat and thinking fixes) with the live limits and price. A new `anthropic/*` id goes through OpenAI Completions, so a new Claude family is never sent budget-thinking parameters it may reject. Input comes from `architecture.input_modalities`. A live price of -1 is no rate. pi-ai's `personalizeOpenRouterCatalog` could later narrow a catalogue to a key's own list.
- **Gemini models** that pi-ai's catalogue knows keep its metadata (thinking levels, limits). A new id gets text input only, the limits Gemini reports, no thinking levels and, unless the Gemini rate table has it, no rate.
- **KIE** does not document its model lists' response shape: it is read as an OpenAI-style `{ data: [{ id }] }` list. A list that names none of the package's models counts as a failed refresh, so the definitions stay in use.

#### Excluded models

These are never listed or run, on the live list and on the installed catalogue alike; a turn on one fails with `UNKNOWN_MODEL` before anything is sent. Each provider package decides them in its `chatKit.offers()`.

- **Image output, every provider** (product-owner decision): Gems do not take image answers yet; offering them will be a separate decision. On OpenRouter, any model whose `architecture.output_modalities` has `image` (`google/gemini-3-pro-image`, `openai/gpt-5-image`, …); in pi-ai's catalogue, which has no output modalities, any id that is also in pi-ai's OpenRouter image catalogue (`google/gemini-3-pro-image`, `google/gemini-nano-banana-2.1`). On Gemini, `-image` ids and Nano Banana ones (`nano-banana-pro-preview`, `gemini-nano-banana-2.1`).
- **Routers and moving aliases, every provider** (product-owner decision): a model whose provider picks the model itself, which can silently change both its behaviour and its price. On OpenRouter: every `openrouter/*` id (`openrouter/auto`, `auto-beta`, `fusion`, `free`, and any new one); on the live list, every model OpenRouter tags as a router (`architecture.tokenizer` is `Router`), so a new one needs no release; the third-party routers `typesafe/jev-router` and `nvidia/switchyard`, by id, since pi-ai's catalogue has no such tag; and every `-latest` alias, with or without the `~` prefix (`~google/gemini-flash-latest`, `~unbiased/pareto-latest`, `openai/gpt-chat-latest`). On Gemini, every `-latest` alias (`gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`).
- **OpenRouter `:batch` models**: the kit sends no batch requests.
- **OpenRouter `:free` models**: they are heavily rate-limited, and their providers may train on the prompts, which does not suit a newsroom gateway.

What each listed model says about itself, under `model.chatKit`:

| Field | Meaning |
| --- | --- |
| `fileInput` | The model reads PDFs natively (pi-ai's `input` has only `text` and `image`) |
| `fileDocuments` | Whether a turn may send it both PDF and image documents: the provider takes them (not KIE or ToAPIs yet) and the model reads both natively. A model without file input is `false`, since a PDF never goes to a paid parser. A model from pi-ai's OpenRouter catalogue (the live list unreadable) is `false` too |
| `tools` | Whether a turn may send it `Context.tools`: the provider takes tools (not KIE or ToAPIs yet) and the model does (OpenRouter: `supported_parameters` has `tools`) |
| `responseSchema` | Whether a turn without `reasoning` may carry a `responseSchema`. With a reasoning level, a schema may still be `UNSUPPORTED` (Anthropic Messages without native structured output) |
| `rate` | The model's dated rate schedule (`ModelRate`), or absent when the model has none: never a zero rate |

### Documents

| Type | Gemini | OpenAI Completions (OpenRouter) | Anthropic Messages | OpenAI Responses |
| --- | --- | --- | --- | --- |
| `text/plain`, `text/markdown`, `text/csv`, `text/html`, `application/json` | `text` part | `text` part | `text` block | `input_text` |
| `application/pdf` | `fileData` or `inlineData` | `file` (`file_data`: URL or data URL) | `document` (URL or base64 source) | `input_file` (`file_url` or `file_data`) |
| `image/png`, `image/jpeg`, `image/webp` | `fileData` or `inlineData` | `image_url` | `image` (URL or base64 source) | `input_image` |

- Plain-text documents are loaded, decoded as UTF-8 and sent on every provider as a text block labelled with the file name (`<document name="notes.md">…</document>`).
- PDFs and images use each API's native file input: by URL when `url` is set (on Gemini only when `size` is known to be at most 15 MB, and never on Gemini 2.0), inline otherwise.
- KIE and ToAPIs do not document file input, so PDFs and images fail there with `UNSUPPORTED` until a live smoke test enables them. Elsewhere a PDF needs a model with native file input (`chatKit.fileInput`; on OpenRouter, from the live list's `input_modalities`) and an image one with image input; otherwise it fails with `UNSUPPORTED` before anything is sent, as does any other MIME type. So an image-only model such as OpenRouter's `moondream/moondream3-preview` takes images but not PDFs. While OpenRouter's list cannot be read, its models come from pi-ai's catalogue, which has no file input: a PDF fails with `UNSUPPORTED`, while an image still goes to a model that reads images. A Gemini model from the installed catalogue is taken to read PDFs when it reads images.
- Every OpenRouter request, on its Completions route and on its Anthropic Messages route (`anthropic/*`), pins the `file-parser` plugin to the `native` PDF engine, so a PDF never falls through to OpenRouter's paid `mistral-ocr` engine. OpenRouter's [Anthropic Messages reference](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message) takes the same `plugins` array as Completions. KIE and ToAPIs never get the plugin.

Documents never enter pi-ai messages as parts the adapters would drop. A unique marker part opens the first user message and each API's `onPayload` transform replaces it, exactly once, with the parts above.

### Prompt layout and caching

The request is ordered: system prompt, documents, the rest of the conversation. The documents open the first user message of the context, so the prompt is identical across turns, and across sessions with the same documents, up to the end of the documents. Keep each document's `url` stable for that to hold. The kit passes `cacheRetention: "short"`. On Anthropic Messages it adds one cache breakpoint on the last document block, beside pi-ai's own on the system prompt and the last user message (three of Anthropic's four). Gemini caches implicitly.

### Response schema

| API | Sent as |
| --- | --- |
| Gemini | `responseMimeType: "application/json"` and `responseJsonSchema`, without `minItems` / `maxItems` (which Gemini rejects) |
| OpenAI Completions | strict `response_format` (`json_schema`), with the turn's model carrying `compat.openRouterRouting.require_parameters` so OpenRouter routes only to endpoints that honour it |
| OpenAI Responses | strict `text.format` (`json_schema`) |
| Anthropic Messages | a forced call of one tool whose `input_schema` is the schema; its argument deltas stream as `text_*` events. When the turn thinks, on OpenRouter and KIE: native structured output, `output_config.format` (`json_schema`), streamed as `text_*` events |

`responseSchema.name` is 1–64 letters, digits, `_` or `-`. Anthropic rejects a forced tool call while the model thinks: with `reasoning`, or on a model that always thinks. A model always thinks when its catalogue entry says thinking cannot be turned off, or when its id is in the Claude Opus 5, Fable 5 or 5.5 family, matched without a provider prefix and with `.` read as `-` (`claude-opus-5` on KIE, `anthropic/claude-opus-5` or `anthropic/claude-sonnet-5.5` on OpenRouter), since a provider's catalogue may not say so.

A turn that thinks therefore sends its schema as Anthropic's [native structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) instead, where the provider takes it. The grammar constrains only the answer, so the model still thinks. The kit merges `format` beside pi-ai's own `output_config` (its effort), and strips the keywords native structured output rejects with a 400: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `maxItems`, `uniqueItems`, `minProperties`, `maxProperties`, a `minItems` other than 0 or 1, and string formats outside Anthropic's list. It also closes every object with `additionalProperties: false`, so validate the answer against your own schema.

| Provider | Native structured output on Anthropic Messages |
| --- | --- |
| `openrouter` | Yes: its [Messages reference](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message) documents `output_config.format` (not yet checked live) |
| `kie` | Yes: undocumented, but verified live on 2026-10-16, where `claude-opus-5-5` answered valid JSON under it while thinking |
| `toapis` | Not yet: undocumented and unverified, so a thinking turn with a schema fails with `UNSUPPORTED` before anything is sent |

### Errors

An error turn has `stopReason: "error"` and `message.chatKit.error`: `{ code, status? }`, present exactly when `stopReason` is `"error"`. `errorMessage` is the account, `rawStopReason` the provider's own value. A new code may come in a minor release: treat an unknown code as `PROVIDER_ERROR`.

| `chatKit.error.code` | Meaning | Sent? |
| --- | --- | --- |
| `CONTENT_BLOCKED` | A safety system blocked the prompt or the answer. `rawStopReason` is the provider's value: Gemini `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST` or `SPII` (finish reason) or the prompt's `promptFeedback.blockReason`; `content_filter` on the OpenAI APIs, and `refusal` on OpenAI Responses; `refusal` or `sensitive` on Anthropic | Yes |
| `PROVIDER_ERROR` | The provider failed (`status` is its HTTP status, when there was one), or the answer stopped early: Gemini `RECITATION`, a broken stream, or a `responseSchema` answer cut off at `maxTokens` (`rawStopReason`: `MAX_TOKENS`, `length`, `max_tokens` or `incomplete.max_output_tokens`), including a forced tool call on Anthropic Messages | Yes |
| `UNSUPPORTED` | The provider or model cannot take the turn's documents, images, tools, schema or settings | No |
| `UNKNOWN_MODEL` | No provider has that id, or the model is not offered (see `listModels`; the message says when the live list could not be read) | No |
| `INVALID_REQUEST` | The input is malformed, tools and a response schema are both set, or a document's `load()` failed | No |

An abort is pi-ai's `stopReason: "aborted"`, with no `chatKit.error` (0.2.0's `ABORTED` code is gone). A turn that fails after partial text still ends with the `error` event; the text already streamed is the consumer's to keep or drop. Gemini bills blocked prompts, so a failed turn carries `chatKit.usage` whenever the provider reported it.

Only the initial request is retried, before the response stream starts: by pi-ai, for 408, 409, 429, 5xx and connection errors, honouring `Retry-After`, up to `maxRetries` (default 2). A turn is never re-sent after its first token, and never to another provider or model.

### Usage and cost

`message.chatKit.usage` holds what the provider reported, read from its own usage record, never pi-ai's zero-filled counts ([ADR 0005](docs/adr/0005-provider-reported-usage.md)), and the turn's cost. It uses pi-ai's count names. Every count is optional: one the provider did not report is absent, never `0` and never computed from the others. A turn has `usage` whenever the provider reported any token count or a cost or credit, and `raw` then keeps the provider's record, so a reported cost or credit survives a missing count. Only a turn whose provider reported none of these has no `usage` at all. Billing reads `chatKit.usage`; `message.usage` stays pi-ai's.

| Field | Meaning | Present in `usage` |
| --- | --- | --- |
| `input` | Prompt tokens not read from or written to the cache: the reported prompt count minus the reported cache counts, left out if negative. The whole prompt is `input + cacheRead + cacheWrite`. On Gemini the prompt includes the tool-use prompt tokens of grounding (`toolUsePromptTokenCount`) | When reported |
| `output` | Every generated token, reasoning included | When reported (a Gemini blocked prompt has none) |
| `totalTokens` | The provider's own total | When reported (never on Anthropic, which reports none) |
| `cacheRead` | Prompt tokens read from the prompt cache | When reported |
| `cacheWrite` | Prompt tokens written to the prompt cache | When reported (never on Gemini) |
| `reasoning` | Thinking tokens (part of `output`) | When reported |
| `costUsd` | The turn's cost in USD | When the provider reported one or the model has a rate and a count to price |
| `costSource` | `provider` or `estimated` | With `costUsd` |
| `raw` | The provider's own record under its own field names: `{ usageMetadata }` on Gemini, otherwise `{ usage }`, plus any cost or credit field reported beside it | Always |

The cost comes from the first source that applies:

1. **Provider-reported** (`costSource: "provider"`): OpenRouter's `usage.cost`, or KIE's `credits_consumed` × $0.005. KIE's cost always comes from its credits, because its token counts are unreliable (hidden prompt tokens, some zero input counts), so a KIE turn without credits has no cost. On KIE Codex (OpenAI Responses) the credits are read wherever the stream carries them: next to `type` on the `response.completed` event (where KIE documents them), on the response object, or in a usage object; `raw` keeps them at its top level.
2. **Estimated** (`costSource: "estimated"`): the model's [rate](#chat-rates) in force when the turn started, priced with pi-ai's `calculateCost`. The large-prompt tier is chosen by the whole prompt (`input + cacheRead + cacheWrite`). Cached and cache-write tokens are charged at their rates, an unpublished one derived as described in [Chat rates](#chat-rates), cache writes as 5-minute writes, and the rest of the prompt at the input rate. `output`, reasoning included, is charged at the output rate. A count the provider did not report adds nothing. Rates come from the KIE and ToAPIs definitions, the Gemini rate table (`googleChatRate`) and OpenRouter's live price (pi-ai's catalogue price while no live list could be read).
3. **None**: no rate, or no counts to price. `costUsd` and `costSource` are absent, never `0`.

### Upgrading from chat-kit 0.2

0.3.0 is one breaking change ([ADR 0009](docs/adr/0009-chat-kit-contract-aligned-with-pi-ai.md)): provider registration, the turn, the events, the usage names and the model list all follow pi-ai.

| 0.2.0 | 0.3.0 |
| --- | --- |
| `createChatKit({ providers: ChatProviderConfig[] })` | `createChatKit({ providers: ChatProvider[] })`: build each with its package's factory; the pi-ai id replaces the kind, and a config's `name` stays in the consumer |
| `runTurn(input, { signal })` | `streamSimple(model, context, options)` and `completeSimple(...)`; `model` is `{ provider, id }` with the pi-ai id. Breaking out of the loop no longer cancels the request: pass a `signal` |
| `systemPrompt`, `history`, `message`; `documents` (required) | `Context.systemPrompt`, `Context.messages`; the optional `documents` option |
| `settings: { temperature, maxOutputTokens, reasoning }` | Options `temperature`, `maxTokens`, `reasoning`; new `toolChoice`, `sessionId`, `maxRetries` |
| Events `text`, `done { usage, truncated }`, `failed` | pi-ai's events; `truncated` is `stopReason: "length"`; usage and errors are on `message.chatKit` |
| `error { code, provider, model, message, reason, status }`; `ABORTED` | `chatKit.error { code, status? }`, with `provider`, `model`, `errorMessage` and `rawStopReason` on the message; `stopReason: "aborted"` |
| `inputTokens` (cache included), `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens` | `input` (cache excluded), `output`, `cacheRead`, `cacheWrite`, `reasoning` |
| `ChatModelInfo` (`maxOutputTokens`, `input` with `file`); `rate` as a period | pi-ai's `Model` plus `chatKit` (`fileInput`, `fileDocuments`, `tools`, `responseSchema`, `rate` as a `ModelRate`) |

## Google AI Studio (server) integration

1. **Secrets.** Put `KIE_API_KEY`, `TOAPIS_API_KEY` and `GEMINI_API_KEY` in the app's server-side Secrets. Never expose them through Vite `define`, client code or a browser request.
2. **Install.** Add the pinned release URLs to `dependencies` (`"@hk01/pi-ai-extra-kie": "https://github.com/…/kie-v0.5.0/hk01-pi-ai-extra-kie-0.5.0.tgz"`, likewise for ToAPIs and Google; each package has its own version, see Install). Import the packages only from server modules such as `server.ts`. A CommonJS server bundle (`esbuild --format=cjs --packages=external`) works with the main entries.

   The `/pi-ai` subpath (and pi-ai itself) is ESM-only. AI Studio's preview runs `server.ts` as ESM, so a static `/pi-ai` import works there, but the CommonJS production bundle then fails at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Before using `/pi-ai`, either build the server as ESM (`--format=esm --outfile=dist/server.mjs` and `"start": "node dist/server.mjs"`), or load it with `await import("@earendil-works/pi-ai")` and `await import("@hk01/pi-ai-extra-<provider>/pi-ai")`, which esbuild keeps as runtime imports.
3. **Generate / edit.** Read the secret on the server and call the helper. Text-to-image and editing differ only by `model` and `referenceImages`:

   ```ts
   const result = await generateKieImage({
     apiKey: process.env.KIE_API_KEY!,
     model: referenceImages.length > 0 ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
     prompt,
     referenceImages, // template, sources, logo — in the order the prompt describes
     aspectRatio: "16:9",
     signal: abortController.signal,
   });
   res.json({ imageUrl: result.images[0]!.dataUrl });
   ```

4. **Cancellation.** Create an `AbortController` per request, abort it when the browser disconnects (`res.on("close", …)`), and pass its `signal`. Uploads, polling and downloads stop, and the helper rejects with `code: "aborted"`.
5. **Errors.** Show `{ provider, model, code, message }` to users and in logs. Do not retry through another model or provider automatically; offering the user another model is fine.
6. **Usage.** Log `result.taskId` and `result.usage` per request. Send a unique `clientBusinessId` on ToAPIs requests. Re-read ToAPIs tasks whose `billingStatus` is `pending` with `getToapisTask()`, and keep one record per task id.
7. **Upgrade / rollback.** Change the release URL in `package.json` to the new (or previous) version and redeploy. Released assets are never replaced, so a URL always installs the same bytes.

A worked migration through the image kit, with paste-ready files, is in [docs/migration/og-master](docs/migration/og-master/README.md); the image kit covers steps 3–6 (and the model selector and error panel) for you. The finished guides for open-graph-single, Auto OG, InfoCard and opengraph2 remain in the history at [`4f87f16`](https://github.com/kpkonghk01/pi-ai-extra/tree/4f87f16/docs/migration).

## Playground (not released)

```sh
pnpm install
pnpm playground   # builds the packages, then serves http://127.0.0.1:5178
```

Enter provider keys in the page, then run text-to-image, image-to-image and multi-reference requests, re-query billing by task id, or send a KIE, ToAPIs or Gemini chat smoke test. Every event and error goes to a copyable log with keys redacted. The server binds to 127.0.0.1 only and never stores keys. If the log says the server cannot be reached, restart `pnpm playground` and reload the page.

## Release

```sh
git tag kie-v0.1.0 && git push origin kie-v0.1.0      # or toapis-vX.Y.Z / google-vX.Y.Z / openrouter-vX.Y.Z / image-kit-vX.Y.Z / chat-kit-vX.Y.Z
```

Tag the release commit on `main`. The workflow:

1. checks that the tag matches the package version;
2. runs check, build and test for the package and its workspace dependencies (the kits' tests load the provider packages' built entries);
3. packs the `.tgz`;
4. installs it into a fresh project and loads it with `require()` and `import()` (the kits together with packed copies of their provider peers; the image kit with React; the chat kit with pi-ai, from `import()` only, registers all four chat providers, lists their models and runs one failing turn, offline; openrouter with pi-ai, from its `/pi-ai` `import()` only);
5. attaches it to a GitHub Release using `GITHUB_TOKEN`.

Each package is released by its own tag, so a KIE fix does not republish ToAPIs or Google. Never replace an asset that consumers use; publish a new patch version instead ([ADR 0001](docs/adr/0001-registry-free-package-releases.md)).

## Development

```sh
pnpm install --ignore-scripts
pnpm run check   # TypeScript 7 (tsc --noEmit)
pnpm run test    # node:test contract tests with a fake fetch, no network
pnpm run build   # tsdown: dual CJS/ESM + declarations (oxc isolated declarations)
pnpm run pack:kie && pnpm run pack:toapis && pnpm run pack:google && pnpm run pack:openrouter && pnpm run pack:image-kit && pnpm run pack:chat-kit   # → release-artifacts/
```

Exported declarations need explicit types (`isolatedDeclarations`). Provider contracts are in [`referenc-docs/`](referenc-docs/); check them before adding or changing a model operation. Wokey is intentionally excluded.
