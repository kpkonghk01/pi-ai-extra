# pi-ai-extra

Server-only extensions to [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) for KIE, ToAPIs and Gemini image generation, plus KIE, ToAPIs and Gemini chat providers. Three independently installable provider packages, delivered as GitHub Release `.tgz` files (no npm registry), for Node.js 22.19 or later:

| Package | Image models | Chat (pi-ai `Models`) |
| --- | --- | --- |
| `@hk01/pi-ai-extra-kie` | Grok Imagine Image 2.0 (text-to-image, image edit), GPT Image 2 (text-to-image, image-to-image), Nano Banana 2 | Codex (OpenAI Responses), Claude (Anthropic Messages) |
| `@hk01/pi-ai-extra-toapis` | Gemini 3.1 Flash Image (preview), GPT Image 2, GPT Image 2.5 Flare / Sunburst, Seedream 5.0 Pro | Codex (OpenAI Responses), Claude (Anthropic Messages) |
| `@hk01/pi-ai-extra-google` | Gemini 3.1 Flash Image, Gemini 3 Pro Image | Gemini (pi-ai's Gemini adapter and catalogue, explicit key) |

Each package has two entry points:

| Import | Format | Contents | Needs pi-ai |
| --- | --- | --- | --- |
| `@hk01/pi-ai-extra-<provider>` | CommonJS **and** ESM | `generate<Provider>Image()`, model catalogue, task lookup, errors | No |
| `@hk01/pi-ai-extra-<provider>/pi-ai` | ESM only | pi-ai `Provider` factory serving the chat and image models | Yes (`@earendil-works/pi-ai@1.2.0`, optional peer) |

The `/pi-ai` subpath is ESM-only because pi-ai itself is ESM-only; a CommonJS server that does not use pi-ai can `require()` the main entry.

A fourth package, [`@hk01/pi-ai-extra-image-kit`](packages/image-kit/README.md), is the image client for Google AI Studio apps built on the three provider packages (their peer dependencies): model families derived from the installed catalogues through an app-owned, route-scoped catalogue policy, request validation, NDJSON streaming, a browser reader and React UI (model selector, error panel). Only its `/server` entry imports the provider packages; its `/browser` and `/react` entries run in the browser and never hold keys or provider code ([ADR 0006](docs/adr/0006-image-kit-package.md), [ADR 0007](docs/adr/0007-catalogue-policy-model-selection.md)).

A fifth package, [`@hk01/pi-ai-extra-chat-kit`](#chat-kit), runs one chat turn the same way on Gemini, OpenRouter, KIE and ToAPIs (documents, response schema, safety blocks, usage), for a server-side gateway with no per-provider code. It is ESM-only and server-only ([ADR 0008](docs/adr/0008-chat-kit-package.md)).

Non-negotiable behaviour (see [ADR 0003](docs/adr/0003-explicit-provider-execution.md)):

- API keys are passed explicitly from server-side configuration. The packages never read environment variables and must not be bundled into browser code.
- No provider fallback, model fallback or cross-provider upload. A failure is reported with its `{ provider, model }`.
- Reference-image limits are validated before any request; images are never dropped.

## Install

Install the exact release asset on the server (build) side and pin the full URL:

```sh
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/kie-v0.3.0/hk01-pi-ai-extra-kie-0.3.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/toapis-v0.3.0/hk01-pi-ai-extra-toapis-0.3.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/google-v0.4.0/hk01-pi-ai-extra-google-0.4.0.tgz
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/image-kit-v0.2.0/hk01-pi-ai-extra-image-kit-0.2.0.tgz   # optional, needs all three
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/chat-kit-v0.1.0/hk01-pi-ai-extra-chat-kit-0.1.0.tgz     # optional, needs all three and pi-ai
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

`createGoogleProvider({ apiKey, modelIds?, baseUrl?, imageSettings? })` serves pi-ai's own Gemini adapter and model catalogue (`GOOGLE_CHAT_MODEL_IDS`) unchanged, including Google's list prices, but authenticates only with the explicit key: unlike pi-ai's `googleProvider()`, it never reads `GEMINI_API_KEY`. `modelIds` restricts the chat list; unknown ids throw.

KIE and ToAPIs chat models use pi-ai's own OpenAI Responses and Anthropic Messages adapters. Capability metadata (context window, thinking levels) is copied from pi-ai's catalogue when the id, or `ChatModelDefinition.catalogueId`, matches; KIE's dashed Codex ids (`gpt-5-6-sol`) point at pi-ai's dotted ones (`gpt-5.6-sol`). Prices are never copied from pi-ai's catalogue, because KIE and ToAPIs prices differ from list prices.

### Chat rates

`KIE_CHAT_MODELS` and `TOAPIS_CHAT_MODELS` carry each model's `cost` in USD per 1M tokens, so pi-ai fills `message.usage.cost`. This is pi-ai's calculation from token counts and the rates below, not a provider-reported charge. Rates as of 2026-10-16:

| Provider | Model | Input | Output | Cache read | Cache write |
| --- | --- | ---: | ---: | ---: | ---: |
| KIE | `gpt-6-astra` | 2.80 | 14.00 | 0.28 | 3.50 |
| KIE | `gpt-5-6-sol` | 1.40 | 8.40 | 0.14 | 1.75 |
| KIE | `gpt-5-6-terra` | 0.56 | 3.36 | 0.056 | 0.70 |
| KIE | `gpt-5-6-luna` | 0.056 | 0.336 | 0.0056 | 0.07 |
| KIE | `claude-fable-5` | 4.00 | 20.00 | 4.00* | 5.00† |
| KIE | `claude-opus-5`, `claude-opus-4-8` | 2.00 | 10.00 | 2.00* | 2.50† |
| KIE | `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5` | 1.425 | 7.15 | 1.425* | 1.78125† |
| KIE | `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5` | 0.85 | 4.275 | 0.85* | 1.0625† |
| KIE | `claude-haiku-4-5` | 0.275 | 1.425 | 0.275* | 0.34375† |
| ToAPIs | `gpt-5.3-codex-official` | 1.40 | 11.20 | 1.40* | 1.75† |
| ToAPIs | `claude-opus-4-6` | 1.50 | 7.50 | 1.50* | 1.875† |
| ToAPIs | `claude-sonnet-4-6` | 0.90 | 4.50 | 0.90* | 1.125† |
| ToAPIs | `claude-haiku-4-5` | 0.30 | 1.50 | 0.30* | 0.375† |

- **KIE**: [kie.ai/pricing](https://kie.ai/pricing), read from `POST https://api.kie.ai/client/v1/model-pricing/page` with `{"pageNum":1,"pageSize":100,"interfaceType":"chat"}`. KIE prices chat in credits per 1M tokens, and 1 credit is $0.005 (for example `claude-sonnet-4-6`: 170 credits in, 855 out).
- **ToAPIs**: `GET https://toapis.com/api/pricing`. Input is 2 × `model_ratio` and output is 2 × `model_ratio` × `completion_ratio` (every group ratio is 1).
- \* Not published. Cache reads are charged at the input rate, an upper bound.
- † Not published. Cache writes are charged at 1.25 × the input rate, the price of a 5-minute cache write on Anthropic and in KIE's own Codex rows. A 1-hour write (`cacheRetention: "long"`) costs 2 × input on Anthropic, so pi-ai under-counts it.

Only models with a published rate are in the default lists. ToAPIs also documents `gpt-5.3-codex` and `gpt-5.3-codex-spark` as chat models, but they have no published price and are not in its public model catalogue, so `TOAPIS_CHAT_MODELS` leaves them out. To use one anyway, pass it in the factory's `models` option. Without a `cost`, pi-ai prices it at 0, so treat its `usage.cost` as unknown, not free:

```ts
createToapisProvider({ apiKey: toapisKey, models: [...TOAPIS_CHAT_MODELS, { id: "gpt-5.3-codex", protocol: "openai-responses" }] });
```

Prices change. To use your own rate, replace the model's `cost` and keep the rest of the list:

```ts
import { createToapisProvider, TOAPIS_CHAT_MODELS } from "@hk01/pi-ai-extra-toapis/pi-ai";

createToapisProvider({
  apiKey: toapisKey,
  // Your own rates in USD per 1M tokens, for example a negotiated price.
  models: TOAPIS_CHAT_MODELS.map((model) =>
    model.id === "claude-sonnet-4-6" ? { ...model, cost: { input: 0.9, output: 4.5, cacheRead: 0.09, cacheWrite: 1.125 } } : model,
  ),
});
```

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

`KIE_CHAT_MODELS` and `TOAPIS_CHAT_MODELS` now carry published rates instead of zero cost (see [Chat rates](#chat-rates)). ToAPIs Claude Haiku is `claude-haiku-4-5`, the public catalogue id, instead of `claude-haiku-4-5-20251001`. ToAPIs `gpt-5.3-codex` and `gpt-5.3-codex-spark` are no longer in the default list, because they have no published rate; pass them in `models` to keep using them.

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

`@hk01/pi-ai-extra-chat-kit` is the server-side chat counterpart of the image kit ([ADR 0008](docs/adr/0008-chat-kit-package.md)). A gateway calls `runTurn()` for every chat turn and needs no per-provider code: Gemini, OpenRouter, KIE and ToAPIs get the same turn features (reference documents, a response schema, safety-block reporting, usage), filled in per wire API where pi-ai 1.2 has none. It is ESM-only (like pi-ai) and server-only. It never chooses a provider and never falls back ([ADR 0003](docs/adr/0003-explicit-provider-execution.md)).

### Install

```sh
pnpm add https://github.com/kpkonghk01/pi-ai-extra/releases/download/chat-kit-v0.1.0/hk01-pi-ai-extra-chat-kit-0.1.0.tgz
pnpm add @earendil-works/pi-ai@1.2.0   # peer, with the KIE, ToAPIs and Google packages above
```

### `createChatKit`

```ts
import { createChatKit } from "@hk01/pi-ai-extra-chat-kit";

const chat = createChatKit({
  providers: [
    { name: "gemini", provider: "google", apiKey: geminiKey, grounding: true },
    { name: "openrouter", provider: "openrouter", apiKey: openRouterKey },
    { name: "kie", provider: "kie", apiKey: kieKey },
    { name: "toapis", provider: "toapis", apiKey: toapisKey, baseUrl: "https://toapis.cn" },
  ],
});
```

| `provider` | pi-ai wire APIs | `baseUrl` (optional) | PDF and image documents |
| --- | --- | --- | --- |
| `google` | Gemini | Chat base URL, default `https://generativelanguage.googleapis.com/v1beta` | Yes |
| `openrouter` | OpenAI Completions; Anthropic Messages for `anthropic/*` | API root, default `https://openrouter.ai/api` (Completions at `<root>/v1`) | Yes |
| `kie` | OpenAI Responses (Codex), Anthropic Messages (Claude) | Host, default `https://api.kie.ai` (`/openai/v1`, `/anthropic`) | Not yet |
| `toapis` | OpenAI Responses (Codex), Anthropic Messages (Claude) | Host, default `https://toapis.com` | Not yet |

- `name` is the consumer's own (for example `gemini` for `google`) and is what a turn's `provider` names. Names are unique; two names may share a provider kind, each with its own key.
- Each provider is registered with its explicit key, in its own pi-ai `Models` collection with an empty auth context: the kit never reads `GEMINI_API_KEY`, `OPENROUTER_API_KEY` or any other environment variable. Google comes from `@hk01/pi-ai-extra-google/pi-ai`, OpenRouter is pi-ai's built-in provider with its environment and OAuth auth replaced by the key, and KIE and ToAPIs come from their `/pi-ai` factories.
- A turn's `model` must be in that provider's pi-ai catalogue (`GOOGLE_CHAT_MODEL_IDS`, pi-ai's OpenRouter catalogue, `KIE_CHAT_MODELS`, `TOAPIS_CHAT_MODELS`); otherwise it fails with `UNKNOWN_MODEL`. The live model lists of [ADR 0008](docs/adr/0008-chat-kit-package.md) come in a later version.
- `grounding: true` (Google only) adds the Google Search and URL context tools to every turn.
- `fetch` (optional) is for tests or instrumentation. It is not applied to Gemini, whose pi-ai adapter rejects a custom fetch.
- An unknown provider, a duplicate name, an empty key, an unknown option or `grounding` on another provider throws a `TypeError`.

### `runTurn`

```ts
for await (const event of chat.runTurn(
  {
    provider: "gemini",
    model: "gemini-3.5-flash",
    systemPrompt: gem.instructions,
    documents: gem.files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      url: file.publicUrl, // optional: the provider fetches the file itself (keep it stable for caching)
      size: file.bytes, // optional: Gemini fetches by URL only when the size is known to be at most 15 MB
      load: () => blobStore.read(file.key), // called only when the bytes must be sent
    })),
    history: session.turns, // [{ role: "user" | "assistant", text }]
    message: userMessage,
    responseSchema: { name: "reply", schema: replyJsonSchema }, // optional: the answer streams as JSON text
    settings: { temperature: 0.7, maxOutputTokens: 2048, reasoning: "low" }, // optional
  },
  { signal: abortController.signal },
)) {
  if (event.type === "text") res.write(event.delta);
  else if (event.type === "done") await usageLog.record(event.usage); // usage: undefined if none was reported; truncated: cut off at the output-token limit
  else await session.saveFailedTurn(event.error, event.usage); // "failed" is always the last event
}
```

A turn emits `text` deltas (thinking is never streamed), then exactly one `done` or `failed` (with `error`). Either carries `usage` only when the provider reported it. It never throws. A free-form answer that stops at the output-token limit (`settings.maxOutputTokens` or the model's maximum) still ends `done`, with `truncated: true`; the text already streamed is the whole, cut-off answer. `truncated` is absent on a normal stop. A turn with a `responseSchema` fails there instead, with `PROVIDER_ERROR`, because a cut-off JSON answer cannot be parsed. Aborting the signal, or stopping the iteration, cancels the request. `settings.reasoning` is pi-ai's `ThinkingLevel` (`minimal` to `max`), clamped to what the model supports; without it, thinking is off where the model allows. Unknown keys in the input, `responseSchema` and `settings` are rejected.

### Documents

| Type | Gemini | OpenAI Completions (OpenRouter) | Anthropic Messages | OpenAI Responses |
| --- | --- | --- | --- | --- |
| `text/plain`, `text/markdown`, `text/csv`, `text/html`, `application/json` | `text` part | `text` part | `text` block | `input_text` |
| `application/pdf` | `fileData` or `inlineData` | `file` (`file_data`: URL or data URL) | `document` (URL or base64 source) | `input_file` (`file_url` or `file_data`) |
| `image/png`, `image/jpeg`, `image/webp` | `fileData` or `inlineData` | `image_url` | `image` (URL or base64 source) | `input_image` |

- Plain-text documents are loaded, decoded as UTF-8 and sent on every provider as a text block labelled with the file name (`<document name="notes.md">…</document>`).
- PDFs and images use each API's native file input: by URL when `url` is set (on Gemini only when `size` is known to be at most 15 MB, and never on Gemini 2.0), inline otherwise.
- KIE and ToAPIs do not document file input, so PDFs and images fail there with `UNSUPPORTED` until a live smoke test enables them. A model whose catalogue `input` lacks `image` rejects them too, as does any other MIME type.
- OpenRouter Completions requests always pin the `file-parser` plugin to the `native` PDF engine, so a PDF never falls through to paid OCR.

Documents never enter pi-ai messages. A unique marker part stands in the first user turn and each API's `onPayload` transform replaces it, exactly once, with the parts above.

### Prompt layout and caching

The request is ordered: system prompt, documents, history, new message. The documents open the first user turn of the transcript (the first user message of `history`, or else the new message), so the prompt is identical across turns, and across sessions with the same documents, up to the end of the documents. Keep each document's `url` stable for that to hold. The kit passes `cacheRetention: "short"`. On Anthropic Messages it adds one cache breakpoint on the last document block, beside pi-ai's own on the system prompt and the last user message (three of Anthropic's four). Gemini caches implicitly.

### Response schema

| API | Sent as |
| --- | --- |
| Gemini | `responseMimeType: "application/json"` and `responseJsonSchema`, without `minItems` / `maxItems` (which Gemini rejects) |
| OpenAI Completions | strict `response_format` (`json_schema`), with OpenRouter `provider.require_parameters` so an endpoint that would ignore it fails instead |
| OpenAI Responses | strict `text.format` (`json_schema`) |
| Anthropic Messages | a forced call of one tool whose `input_schema` is the schema; its argument deltas stream as `text` |

`responseSchema.name` is 1–64 letters, digits, `_` or `-`. Anthropic rejects a forced tool call while the model thinks, so on Anthropic Messages a schema together with `settings.reasoning`, or on a model that always thinks, fails with `UNSUPPORTED` before anything is sent. A model always thinks when its catalogue entry says thinking cannot be turned off, or when its id is in the Claude Opus 5, Fable 5 or 5.5 family, matched without a provider prefix and with `.` read as `-` (`claude-opus-5` on KIE, `anthropic/claude-opus-5` or `anthropic/claude-sonnet-5.5` on OpenRouter), since a provider's catalogue may not say so.

### Errors

| `error.code` | Meaning |
| --- | --- |
| `CONTENT_BLOCKED` | A safety system blocked the prompt or the answer. `reason` is the provider's value: Gemini `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST` or `SPII` (finish reason) or the prompt's `promptFeedback.blockReason`; `content_filter` on the OpenAI APIs, and `refusal` on OpenAI Responses; `refusal` or `sensitive` on Anthropic. |
| `PROVIDER_ERROR` | The provider failed (`status` is its HTTP status, when there was one), or the answer stopped early: Gemini `RECITATION`, a broken stream, or a `responseSchema` answer cut off at the output-token limit (`reason` is the raw stop reason: `MAX_TOKENS`, `length`, `max_tokens` or `incomplete.max_output_tokens`), including a forced tool call on Anthropic Messages. |
| `UNSUPPORTED` | The provider or model cannot take this request (documents, a schema with thinking). Nothing was sent. |
| `UNKNOWN_MODEL` | The provider name is not configured, or the model is not in its catalogue. Nothing was sent. |
| `INVALID_REQUEST` | The input is malformed, or a document's `load()` failed. Nothing was sent. |
| `ABORTED` | The signal aborted the turn. |

Every error names where the turn ran: `error.provider` is the configured provider name (for example `gemini`, not the provider kind) and `error.model` the model id, as the turn gave them (`?` only when malformed input named none). `error.message` starts with `[provider/model]`, built from the two. A turn that fails after partial text still ends `failed`; the text already streamed is the consumer's to keep or drop. Gemini bills blocked prompts, so `failed` carries `usage` whenever the provider reported it.

Only the initial request is retried, before the response stream starts: up to twice, by pi-ai, for 408, 409, 429, 5xx and connection errors, honouring `Retry-After`. A turn is never re-sent after its first token, and never to another provider or model.

### Usage

`usage` holds only what the provider reported, read from its own usage record, never pi-ai's zero-filled counts ([ADR 0005](docs/adr/0005-provider-reported-usage.md)). A count the provider did not report is absent, not `0`; a turn whose provider reported no usage (or no prompt and answer counts) has no `usage` at all.

| Field | Meaning | Present in `usage` |
| --- | --- | --- |
| `inputTokens` | Every prompt token, cache reads and writes included | Always |
| `outputTokens` | Every generated token, reasoning included | Always; Gemini omits zero counters, so a blocked prompt's missing answer count is `0` |
| `totalTokens` | The provider's total; on Anthropic, which reports none, `inputTokens + outputTokens` | Always |
| `cachedInputTokens` | Prompt tokens read from the prompt cache (part of `inputTokens`) | When reported |
| `cacheWriteTokens` | Prompt tokens written to the prompt cache (part of `inputTokens`) | When reported (never on Gemini) |
| `reasoningTokens` | Thinking tokens (part of `outputTokens`) | When reported |
| `raw` | The provider's own record under its own field names: `{ usageMetadata }` on Gemini, otherwise `{ usage }`, plus any cost or credit field reported beside it | Always |

OpenRouter's cost is `raw.usage.cost` and KIE's credits are `raw.credits_consumed`. The kit computes no cost yet: estimating one from model rates when the provider reports none ([ADR 0008](docs/adr/0008-chat-kit-package.md)) comes in a later version.

## Google AI Studio (server) integration

1. **Secrets.** Put `KIE_API_KEY`, `TOAPIS_API_KEY` and `GEMINI_API_KEY` in the app's server-side Secrets. Never expose them through Vite `define`, client code or a browser request.
2. **Install.** Add the pinned release URLs to `dependencies` (`"@hk01/pi-ai-extra-kie": "https://github.com/…/kie-v0.3.0/hk01-pi-ai-extra-kie-0.3.0.tgz"`, likewise for ToAPIs and Google; each package has its own version, see Install). Import the packages only from server modules such as `server.ts`. A CommonJS server bundle (`esbuild --format=cjs --packages=external`) works with the main entries.

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
git tag kie-v0.1.0 && git push origin kie-v0.1.0      # or toapis-vX.Y.Z / google-vX.Y.Z / image-kit-vX.Y.Z / chat-kit-vX.Y.Z
```

Tag the release commit on `main`. The workflow:

1. checks that the tag matches the package version;
2. runs check, build and test for the package and its workspace dependencies (the kits' tests load the provider packages' built entries);
3. packs the `.tgz`;
4. installs it into a fresh project and loads it with `require()` and `import()` (the kits together with packed copies of their provider peers; the image kit with React; the chat kit with pi-ai, from `import()` only, and runs one offline turn);
5. attaches it to a GitHub Release using `GITHUB_TOKEN`.

Each package is released by its own tag, so a KIE fix does not republish ToAPIs or Google. Never replace an asset that consumers use; publish a new patch version instead ([ADR 0001](docs/adr/0001-registry-free-package-releases.md)).

## Development

```sh
pnpm install --ignore-scripts
pnpm run check   # TypeScript 7 (tsc --noEmit)
pnpm run test    # node:test contract tests with a fake fetch, no network
pnpm run build   # tsdown: dual CJS/ESM + declarations (oxc isolated declarations)
pnpm run pack:kie && pnpm run pack:toapis && pnpm run pack:google && pnpm run pack:image-kit && pnpm run pack:chat-kit   # → release-artifacts/
```

Exported declarations need explicit types (`isolatedDeclarations`). Provider contracts are in [`referenc-docs/`](referenc-docs/); check them before adding or changing a model operation. Wokey is intentionally excluded.
