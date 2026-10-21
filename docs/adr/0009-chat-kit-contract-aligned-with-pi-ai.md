# ADR 0009: Align the Chat kit 0.3.0 contract with pi-ai

- Status: Accepted (2026-10-21)
- Date: 2026-10-21
- Related: [ADR 0008](0008-chat-kit-package.md) (superseded in part), [ADR 0002](0002-dual-layer-provider-contract.md), [ADR 0003](0003-explicit-provider-execution.md), [ADR 0005](0005-provider-reported-usage.md), data-gen-ai-portal ADR 0010, [DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583), [DATA-4580](https://hk01-digital.atlassian.net/browse/DATA-4580), [DATA-4564](https://hk01-digital.atlassian.net/browse/DATA-4564)

## Context

pi-ai-extra extends pi-ai. It adds Providers or extends existing ones, and reuses pi-ai's types, names and mechanisms wherever they fit (product owner, 2026-10-21). Chat kit 0.2.0 does not. It has its own turn input (system prompt, text history, message), its own events (`text`, `done`, `failed`), its own setting and usage names, and a closed list of provider kinds built inside the kit.

Chat kit is not in production yet. Its contract changes once, now, in 0.3.0. Anything that would break consumers again later is settled here. The portal is the first consumer application; Google AI Studio apps that use the Image kit may adopt Chat kit.

The contract must serve three planned uses ([DATA-4564](https://hk01-digital.atlassian.net/browse/DATA-4564), 2026-10-21). This ADR designs for them; it does not build them:

1. an internal LLM API router (OpenAI-compatible `/chat/completions` and `/responses`, Anthropic-compatible `/messages`) with central usage records;
2. a multi-tenant BYOK service, where tenants bring Provider or reseller keys, issue downstream API keys, and have usage recorded per key;
3. a multi-tenant BYOK agent platform, like Poe bots or Gemini Gems, with flows, tools and MCP, secrets and cron.

Chat kit cannot be a thin layer over pi-ai's `streamSimple()`. pi-ai 1.2.0 lacks:

- a document or file block. `UserMessage.content` takes text and `ImageContent`, which is base64 only, with no URL form.
- a response-format option on the APIs Chat kit uses.
- a blocked stop reason. `StopReason` is `pending | stop | length | toolUse | error | aborted | deferred`, and a safety stop maps to `error` (Gemini `SAFETY`, OpenAI `content_filter`, Anthropic `refusal`). A Gemini prompt-level block is not reported at all.
- optional usage counts and the raw usage. Every `Usage` count except `reasoning` and `cacheWrite1h` is a required number, set to 0 when unreported, and `totalTokens` is computed.
- a `file` model input. `ModelInputModality` is `text | image`.
- capability, rate or cost-policy data on a `Provider`.

pi-ai also replaces an image with placeholder text when the model has no image input (`transformMessages`). ADR 0003 forbids silently discarding images.

## Decision

Chat kit 0.3.0 takes pi-ai's `Context`, pi-ai's option names and pi-ai `Provider`s, and returns pi-ai's event stream. What pi-ai has no equivalent for stays Chat kit's own. It sits beside pi-ai's types, never in a fork of them.

**One rule for additions.** Every Chat kit addition to a pi-ai object lives under one member, `chatKit`: a chat provider's traits (`provider.chatKit`) and a final message's turn record (`message.chatKit`). The name marks the member as Chat kit's and keeps clear of pi-ai's own fields.

### 1. Providers and registration

A **chat provider** is a pi-ai `Provider` with one added member, `chatKit`: the traits Chat kit needs and pi-ai has no field for.

```ts
// Defined once in the internal package; exported by each provider package's /pi-ai entry and by Chat kit.
export type ChatProvider<TApi extends Api = Api> = Provider<TApi> & { readonly chatKit: ChatProviderTraits };

export interface ChatProviderTraits {
  /** PDF and image documents go through each API's native file input. Off until verified live. */
  readonly fileDocuments: boolean;
  /** Anthropic Messages takes native structured output (`output_config.format`). */
  readonly nativeStructuredOutput: boolean;
  /** Whether a model is offered: ADR 0008's exclusions (image output, routers, moving aliases, `:free`, `:batch`). */
  offers(model: Model<Api>): boolean;
  /** What a model reads, `file` (native PDF input) included. */
  input(model: Model<Api>): readonly ChatModelInput[];
  /** Whether a turn may send this model `Context.tools`. False on a provider not yet verified live. */
  tools(model: Model<Api>): boolean;
  /** The model's dated rate; undefined when it has none, never a zero rate. */
  rate(model: Model<Api>): ModelRate | undefined;
  /** The provider's own charge in a turn's raw usage record, in USD; undefined when it reported none. */
  reportedCostUsd(raw: Record<string, unknown>): number | undefined;
  /** Whether a turn without a reported charge is estimated from the model's rate. */
  readonly estimatesCost: boolean;
}
```

A chat provider is still a pi-ai `Provider`. `models.setProvider()` takes it, and a pi-ai consumer that ignores `chatKit` loses nothing. A trait added later is optional, with the conservative default (off), so an existing factory never breaks.

Each provider package keeps one factory (ADR 0002), which now returns a chat provider:

| Package, `/pi-ai` entry | Factory | New options | Live list, as `refreshModels` | Stream wrapper |
| --- | --- | --- | --- | --- |
| `@hk01/pi-ai-extra-google` | `createGoogleProvider` | `grounding?`, `fetch?` | `models.list`, filtered as today | Grounding tools via `onPayload`; `promptFeedback.blockReason` copied to `rawStopReason` |
| `@hk01/pi-ai-extra-openrouter` (new) | `createOpenRouterProvider({ apiKey, baseUrl?, fetch? })` | — | Public `/models` | — |
| `@hk01/pi-ai-extra-kie` | `createKieProvider` | `fetch?` | Codex and Claude lists, intersected with the definitions | KIE error envelope (exists) |
| `@hk01/pi-ai-extra-toapis` | `createToapisProvider` | `fetch?` | `/v1/models?type=text`, intersected with the definitions | — |

- `createOpenRouterProvider` extends pi-ai's `openrouterProvider()`; it does not replace it. It keeps the id `openrouter`, pi-ai's catalogue, adapters, image and classifier models. It replaces only the auth (the explicit key, instead of `OPENROUTER_API_KEY` and OAuth) and adds the live list and `chatKit`.
- A live list is the provider's `refreshModels`, pi-ai's mechanism, so `models.refresh()` reads it for any pi-ai consumer. It replaces the list, so a model the provider drops disappears. pi-ai's `createProvider({ fetchModels })` merges over the baseline and never removes one, so the packages write `refreshModels` themselves. Before the first refresh, `getModels()` is the installed catalogue or definitions.
- Chat kit keeps the freshness rules of ADR 0008: 30-minute stale-while-revalidate, 5 s and 15 s deadlines, a one-minute retry after a failure. It calls `models.refresh({ providers: [id], force: true, signal })` under them.
- What stays per wire API in Chat kit: documents, the response schema, reading usage from the provider's own record, blocked classification, HTTP status capture, and the always-thinking Claude rule.
- Internals move to pi-ai's mechanisms where they exist: the cost estimate uses `calculateCost` (section 5), and a schema turn on OpenRouter sets `require_parameters` through `compat.openRouterRouting` instead of the payload transform.

Traits by provider. "Not yet" turns on after a live smoke test, as document support does today.

| Trait | `google` | `openrouter` | `kie` | `toapis` |
| --- | --- | --- | --- | --- |
| `fileDocuments` | Yes | Yes | Not yet | Not yet |
| `tools` | Yes | Per model: the live list's `supported_parameters` has `tools` | Not yet | Not yet |
| `nativeStructuredOutput` | No (not Anthropic Messages) | Yes | Yes | Not yet |
| Cost | Estimated | `usage.cost`, else estimated | `credits_consumed` × $0.005, never estimated | Estimated |

Registration:

```ts
export function createChatKit(options: ChatKitOptions): ChatKit;

export interface ChatKitOptions {
  /** Chat providers from provider package factories, each built with its explicit key. */
  providers: readonly ChatProvider[];
  /** For tests or instrumentation: every turn's requests, except Gemini's (pi-ai's Gemini adapter rejects a custom fetch). */
  fetch?: typeof globalThis.fetch;
}
```

- Chat kit identifies a provider by its pi-ai provider id, `provider.id`, as pi-ai does. It takes no provider names of its own (decided by the product owner, 2026-10-21): choosing names is a consumer's concern, so a consumer with names of its own maps them before calling.
- The providers sit in one pi-ai `Models` collection with an empty auth context. pi-ai's `setProvider()` replaces a provider with the same id silently, so Chat kit throws a `TypeError` on a duplicate id instead. It throws one too for a provider without `chatKit`.
- Keys, base URLs and grounding move into the factories. Chat kit never handles a key, and never reads the environment (ADR 0003). Mapping the consumer's configuration to factories is the consumer's code: it imports the factories it uses and calls each with its keys. An optional helper that takes the consumer's own factory table could be added later without a break.

**BYOK: one kit per tenant.** A multi-tenant consumer creates one kit from each tenant's keys and caches it by tenant. Two keys for the same provider, such as two OpenRouter keys, are two kits: within a kit a provider id is unique. Keys are not passed per call, although pi-ai's `ProviderRequestOptions.apiKey` would allow it (a per-call key can still be added later, without a break):

- A model list belongs to a key: Gemini, KIE and ToAPIs are read with the key, and OpenRouter has a per-key `/models/user`. The kit caches lists by provider.
- A chat provider keeps a provider and its key together. That is the attribution and no-fallback boundary of ADR 0003.
- A kit holds no timers or sockets between calls, so a dropped kit needs no `dispose()`.

**DATA-4580's contract lands in 0.3.0** (decided by the product owner, 2026-10-21). `ChatProviderConfig` and `ChatProviderKind` go now, not in a second breaking release. The trade-off: 0.3.0 ships with four provider package releases, one of them new, and DATA-4572 and DATA-4573 wait for it. Otherwise the portal's provider config and `createChatKit` call would break twice. Chat kit stops importing the provider packages, so they become optional peers, and the portal can uninstall ToAPIs. What remains of DATA-4580, none of it public:

- the key-gated smoke script (`pnpm smoke:chat --provider <id>`), which also checks tool calls;
- the "Adding a reseller" checklist in `docs/design/`, with tool calls added to what is verified live;
- moving each provider's quirk code from the internal package, where 0.3.0 leaves it, into that provider's own package;
- later, as before: a generic factory for well-behaved OpenAI- or Anthropic-compatible resellers.

### 2. Turn

```ts
export interface ChatKit {
  /** First overload: a Gem-style turn, whose answer follows a JSON Schema and whose context declares no tools. Second: any other turn, tools allowed. */
  streamSimple(model: ChatModelRef, context: ChatSchemaContext, options: ChatSchemaStreamOptions): ChatTurnStream;
  streamSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): ChatTurnStream;
  completeSimple(model: ChatModelRef, context: ChatSchemaContext, options: ChatSchemaStreamOptions): Promise<ChatAssistantMessage>;
  completeSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): Promise<ChatAssistantMessage>;
  listModels(options?: ChatListModelsOptions): Promise<ChatProviderModels[]>;
}

/** pi-ai `Model`'s own fields: the pi-ai provider id and that provider's model id. */
export interface ChatModelRef {
  provider: string;
  id: string;
}

/** What every turn takes: pi-ai's options, plus reference documents. */
type ChatBaseStreamOptions = Pick<SimpleStreamOptions, "signal" | "temperature" | "maxTokens" | "reasoning" | "sessionId" | "maxRetries"> & {
  /** Reference documents. They open the first user message, so provider prompt caching covers them. */
  documents?: readonly ChatDocument[];
};

/** A turn that may use tools. It has no response schema. */
export type ChatStreamOptions = ChatBaseStreamOptions & Pick<SimpleStreamOptions, "toolChoice"> & { responseSchema?: undefined };

/** A turn whose answer follows a JSON Schema. The answer then streams as JSON text. */
export type ChatSchemaStreamOptions = ChatBaseStreamOptions & { responseSchema: ChatResponseSchema };

/** pi-ai's `Context` without tools: the context of a response-schema turn. */
export type ChatSchemaContext = Omit<Context, "tools"> & { tools?: undefined };
```

- The calls mirror pi-ai's `Models.streamSimple(model, context, options)` and `completeSimple()`. The names `stream()` and `complete()` stay free for a later variant with per-API options.
- `model` is a reference with pi-ai `Model`'s own fields, `provider` (the pi-ai provider id) and `id`, so a pi-ai `Model` is a reference too. Chat kit resolves it against its own model list. Parsing a string such as `"google/gemini-3.5-flash"` is the consumer's.
- `context` is pi-ai's `Context`, unextended: system prompt, user, assistant, tool-result and system messages, tools, images. A router hands it on unchanged. pi-ai's `TranscriptContext`, which pi-agent-core passes, fits too: `normalizeContext` keeps its messages as they are.
- **Tools and a response schema are mutually exclusive** (decided by the product owner, 2026-10-21). Tools serve the agent use case; a response schema serves the Gem use case. The overloads enforce it: with `responseSchema`, the context has no `tools`, and the other overload takes no `responseSchema`. Untyped callers, such as a router mapping JSON requests, can still send both. That is the caller's error, not a model's limit, so the turn fails before sending with `INVALID_REQUEST`. The runtime check reads the normalized transcript, so it also counts tools a system message adds (`toolsAdded`), which the type cannot see. An empty `tools` array counts as no tools.
- Documents and the response schema sit beside the `Context`, in the options. `ChatDocument` (`{ name, mimeType, url?, size?, load }`) and `ChatResponseSchema` (`{ name, schema }`) are unchanged.
- The settings are pi-ai's: `temperature`, `maxTokens`, `reasoning` (`ThinkingLevel`). Without `reasoning`, thinking is off where the model allows it, which is pi-ai's own rule.
- `maxRetries` defaults to 2. pi-ai retries only before the stream starts, so a turn is never re-sent after its first token.
- `cacheRetention` is fixed at `"short"`, because the cost estimate prices an unpublished cache-write rate as a 5-minute write.
- `completeSimple()` is `streamSimple(...).result()`, as in pi-ai. It still streams the request.

### 3. Tools

- `Context.tools`, tool calls and tool results pass through to pi-ai unchanged. pi-ai supports them on every API Chat kit uses.
- Chat kit refuses tools in two cases only, each before anything is sent, with `UNSUPPORTED`:
  - a provider whose tool support has not been verified live (`chatKit.tools` is false). KIE and ToAPIs stay off until a live smoke test (decided by the product owner, 2026-10-21): a reseller that ignored `tools` would answer without calling them, silently.
  - a model without tool support (OpenRouter's live list).
- `toolChoice` is pi-ai's `ToolChoice`, `"auto" | "none"`. A forced or named choice (OpenAI `required`, Anthropic `{ type: "tool" }`) would widen this union later. Widening an input type breaks no caller.
- **Response schema.** A turn has tools or a response schema, never both (section 2). The response schema keeps 0.2.0's rules, including the forced tool call on Anthropic Messages. Chat kit turns that call into text: the tool's events become `text_start`, `text_delta` and `text_end`, its block becomes a text block, and `stopReason` is `"stop"`. On every API, the schema answer is the message's text.

### 4. Output

`streamSimple()` returns a pi-ai `AssistantMessageEventStream`. Its events are pi-ai's `AssistantMessageEvent`s: `start`; `text_*`, `thinking_*` and `toolcall_*`; then `done { reason }` or `error { reason }`. Chat kit passes pi-ai's events through, except that it turns a forced schema tool call into text (section 3) and ends a turn it fails with its own `error` event. The stream's `result()` is the final message, with Chat kit's record on it.

```ts
export interface ChatTurnStream extends AssistantMessageEventStream {
  result(): Promise<ChatAssistantMessage>;
}

/** pi-ai's final message, plus Chat kit's turn record. */
export type ChatAssistantMessage = AssistantMessage & { chatKit: ChatTurnRecord };

export interface ChatTurnRecord {
  /** The Usage record. Absent when the provider reported no count, cost or credit. */
  usage?: ChatUsage;
  /** Present exactly when `stopReason` is `"error"`. */
  error?: ChatTurnError;
}

export interface ChatTurnError {
  code: ChatTurnErrorCode;
  /** HTTP status of the provider's error response, when there was one. */
  status?: number;
}
```

The record rides on the final message rather than in a separate `result()` shape:

- The stream stays a real pi-ai `AssistantMessageEventStream`. Whatever consumes one consumes it: pi-agent-core's loop (through a `StreamFn` adapter), a router turning events into SSE, existing pi-ai code.
- pi-ai already keeps per-response metadata on the message: `rawStopReason`, `errorMessage`, `responseId`, `diagnostics`.
- The message goes back into `Context.messages` as history as it is. pi-ai's adapters ignore the extra member. `message.provider`, `api` and `model` stay pi-ai's, because pi-ai replays thinking and Gemini thought signatures only when they match the next turn's model.
- Since `message.provider` is the pi-ai provider id, the record needs no provider field. It follows the `chatKit` rule above.

Where each 0.2.0 result now is:

| 0.2.0 | 0.3.0 |
| --- | --- |
| `text` event | `text_delta` event; text blocks of the message |
| `done { truncated: true }` | `done { reason: "length" }`, `stopReason: "length"` |
| `failed { error }` | `error { reason: "error" }`, with `chatKit.error` |
| Error code, HTTP status | `chatKit.error.code`, `chatKit.error.status` |
| Raw stop or block reason | `message.rawStopReason` |
| Error text | `message.errorMessage`, starting `[provider/model]` |
| `usage` on `done` or `failed` | `chatKit.usage` on the final message, whatever its stop reason |
| `ABORTED` | `error { reason: "aborted" }`, `stopReason: "aborted"`, no `chatKit.error` |
| Thinking, never streamed | `thinking_*` events and thinking blocks |

- A response-schema answer cut off at `maxTokens` cannot be parsed, so it still ends as an error (`PROVIDER_ERROR`, with `rawStopReason` kept). A free-form answer cut off there ends `done { reason: "length" }`, and its text stands.
- `message.usage` is pi-ai's, unchanged: zero-filled counts, priced by pi-ai. It serves pi-ai's own uses, such as context size. Usage records and billing read `chatKit.usage`.

```ts
const stream = chat.streamSimple({ provider: "google", id: "gemini-3.5-flash" }, context, { documents, responseSchema });
for await (const event of stream) if (event.type === "text_delta") res.write(event.delta);
const message = await stream.result(); // never rejects
if (message.stopReason === "error") showError(message.chatKit.error!.code, message.rawStopReason);
await usageLog.record(message.chatKit.usage); // undefined when the provider reported nothing
```

### 5. Usage and cost

```ts
/** The Usage record (ADR 0005), with pi-ai's count names. A count is present only when the provider reported it. */
export interface ChatUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  costUsd?: number;
  costSource?: "provider" | "estimated";
  raw: Record<string, unknown>;
}
```

| Field | Name and meaning | Value |
| --- | --- | --- |
| `input` | pi-ai's | Prompt tokens neither read from nor written to the cache: the reported prompt count, less the cache counts reported beside it, as pi-ai's `calculateCost` reads `input` |
| `output` | pi-ai's | Every generated token, reasoning included |
| `cacheRead`, `cacheWrite` | pi-ai's | Prompt tokens read from or written to the cache. Gemini reports no writes |
| `reasoning` | pi-ai's | Reasoning tokens, part of `output` |
| `totalTokens` | pi-ai's name, Chat kit's meaning | The provider's own total. pi-ai computes it; Chat kit never does, so Anthropic Messages has none |
| `costUsd`, `costSource`, `raw` | Chat kit's | As in 0.2.0 |

- The glossary's rule holds: a count the provider did not report is absent, never 0. pi-ai's `Usage` cannot say that, which is why the record sits beside it.
- `input` changes meaning. 0.2.0's `inputTokens` included cache tokens; the whole prompt is now `input + cacheRead + cacheWrite`.
- The cost order is unchanged: the provider's charge (`chatKit.reportedCostUsd`), else an estimate (`chatKit.estimatesCost`), else none. The estimate is pi-ai's `calculateCost`, priced with the rate period in force when the turn started, with unpublished cache rates derived as ADR 0005 says. A count the provider did not report adds nothing.

### 6. Model listing

```ts
export type ChatModelInput = ModelInputModality | "file";

export interface ChatModelInfo {
  provider: string; // the pi-ai provider id: { provider, id } is a ChatModelRef
  id: string;
  name: string;
  api: Api;
  input: ChatModelInput[];
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevels: ModelThinkingLevel[];
  tools: boolean;
  fileDocuments: boolean;
  responseSchema: boolean;
  rate?: RatePeriod;
}

export type ChatProviderModels =
  | { provider: string; source: "live" | "installed"; fetchedAt?: string; refreshError?: string; models: ChatModelInfo[] }
  | { provider: string; error: string };
```

- pi-ai's names and meanings: `id`, `name`, `api`, `contextWindow`, `maxTokens`, `reasoning`, and `input` with one added value.
- `thinkingLevels` is pi-ai's `getSupportedThinkingLevels(model)`, without `off` for a model Chat kit knows always thinks.
- Chat kit's extras: the `file` input, `tools`, `fileDocuments`, `responseSchema` (for a turn with no reasoning level), `rate`, and the list's `source`, `fetchedAt` and `refreshError`.
- A list entry's `provider` is pi-ai's `Provider.id`. It replaces 0.2.0's `provider` (the consumer's name) and `kind`.
- ADR 0008's exclusions stay fixed in 0.3.0 (decided by the product owner, 2026-10-21). A per-kit opt-in can come later without a break.

### 7. Errors

```ts
export type ChatTurnErrorCode = "CONTENT_BLOCKED" | "PROVIDER_ERROR" | "UNSUPPORTED" | "UNKNOWN_MODEL" | "INVALID_REQUEST";
```

| Code | Meaning | Sent? |
| --- | --- | --- |
| `UNKNOWN_MODEL` | No provider with that id is registered, or the model is not offered | No |
| `UNSUPPORTED` | The model or provider cannot take the turn's documents, images, tools, schema or settings | No |
| `INVALID_REQUEST` | The model reference, `Context` or options are malformed, the turn has both tools and a response schema, or a document's `load()` failed | No |
| `CONTENT_BLOCKED` | A safety system blocked the prompt or the answer; `rawStopReason` is the provider's value | Yes |
| `PROVIDER_ERROR` | The provider failed, or the answer stopped early | Yes |

- A failure found before sending ends the stream with a lone `error` event, with no `start` and no delta. pi-ai's own `Models.streamSimple()` ends a setup failure the same way (`lazyStream`). A router can answer with a 4xx when the first event is `error`.
- Nothing is thrown: `streamSimple()` never throws and `completeSimple()` never rejects.
- When the model did not resolve, `message.api` is `"unknown"`, and `message.provider` and `message.model` are the reference's.
- An image in the `Context` for a model without image input is `UNSUPPORTED`, so pi-ai never swaps it for placeholder text.
- The code list is closed. A new distinction goes in `status` (such as 429 or 402 within `PROVIDER_ERROR`) or `rawStopReason`, never in a new code, so an exhaustive `switch` never breaks.

### 8. Migration

| 0.2.0 | 0.3.0 |
| --- | --- |
| `createChatKit({ providers: ChatProviderConfig[], fetch? })` | `createChatKit({ providers: ChatProvider[], fetch? })` |
| `ChatProviderConfig { name, provider, apiKey, baseUrl?, grounding? }` | A `ChatProvider` from a package factory, which takes the key, base URL and grounding. `name` stays in the consumer |
| `ChatProviderKind` | Removed: pi-ai's `Provider.id` |
| — | `ChatProvider`, `ChatProviderTraits`, `ChatModelRef`, `ChatStreamOptions`, `ChatSchemaStreamOptions`, `ChatSchemaContext`, `ChatTurnStream`, `ChatAssistantMessage`, `ChatTurnRecord` |
| `ChatKit.runTurn(input, options)` | `ChatKit.streamSimple(model, context, options)`, `ChatKit.completeSimple(...)` |
| `ChatTurnInput.provider` (the consumer's name), `.model` | `ChatModelRef.provider` (pi-ai's provider id), `.id` |
| `ChatTurnInput.systemPrompt` | `Context.systemPrompt` |
| `ChatTurnInput.history`, `.message`; `ChatHistoryMessage` | `Context.messages`: pi-ai `UserMessage` and `AssistantMessage` |
| `ChatTurnInput.documents` (required) | The `documents` option (optional) |
| `ChatTurnInput.responseSchema` | `ChatSchemaStreamOptions.responseSchema`, with a `ChatSchemaContext` |
| `ChatTurnSettings { temperature, maxOutputTokens, reasoning }` | The `temperature`, `maxTokens` and `reasoning` options |
| `ChatTurnOptions { signal }` | The `signal` option |
| `ChatTurnEvent` | pi-ai `AssistantMessageEvent` (table in section 4) |
| `ChatTurnError { code, provider, model, message, reason?, status? }` | `chatKit.error { code, status? }`, `message.provider` (pi-ai's id), `message.model`, `message.errorMessage`, `message.rawStopReason` |
| `ChatTurnErrorCode` `ABORTED` | `stopReason: "aborted"` |
| `ChatUsage.inputTokens` (cache included) | `input` (cache excluded) |
| `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens` | `output`, `cacheRead`, `cacheWrite`, `reasoning` |
| `ChatModelInfo.maxOutputTokens` | `maxTokens`; added: `provider`, `api`, `thinkingLevels`, `tools` |
| `ChatProviderModels.provider` (the consumer's name), `.kind` | `provider`: pi-ai's provider id |
| `ChatModelInput` | `ModelInputModality \| "file"`, the same values |
| `ChatDocument`, `ChatResponseSchema`, `ChatListModelsOptions`, `ModelRate`, `RatePeriod`, `TokenRates`, `LargePromptRates`; `ChatUsage.totalTokens`, `costUsd`, `costSource`, `raw` | Unchanged |

**Portal.** The portal moves once, before DATA-4572 and DATA-4573. In `src/lib/gem/chat/`:

- `provider-config.ts`: each entry maps a permanent Provider name to its chat provider factory and pi-ai id, for example `gemini` → `createGoogleProvider`, id `google`. (The file stays free of runtime imports for `src/lib/env.ts`, so it can name the factory and leave the factory table to `index.ts`.)
- `index.ts`: `createChatKit({ providers })`, with each enabled entry's factory called with its key, for example `createGoogleProvider({ apiKey, grounding: true })`.
- `gem-chat.ts`: maps the portal's `provider/model` reference to `{ provider: id, id: model }` before calling, builds the `Context` with the Gem helper below, calls `streamSimple()`, yields `text_delta`, and reads `result()`. Generation settings' `maxOutputTokens` maps to `maxTokens`.
- `usage.ts`: maps `message.provider` back to the portal's Provider name for the Usage record; the renamed fields; the prompt count is the sum of the reported `input`, `cacheRead` and `cacheWrite`.
- `turn-error.ts`: reads `chatKit.error.code`, `rawStopReason` and `stopReason`, and names the portal's Provider from the turn, not from Chat kit. Its `ABORTED` case becomes `stopReason: "aborted"`.
- `chat-kit-models.ts`: finds a Provider's list by its pi-ai id.
- Unchanged: `preflight.ts`, `read-links.ts`, `errors.ts`.
- Stored Model references and Usage records keep the portal's names: there is no data migration.
- `package.json`: drop `@hk01/pi-ai-extra-toapis`; add `@hk01/pi-ai-extra-openrouter` with DATA-4572.

```ts
const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** A Gem turn as pi-ai's Context. Stored history is text only, with Failed turns already left out. */
export function gemContext(turn: { systemPrompt: string; history: ChatMessage[]; message: string }): Context {
  const timestamp = Date.now();
  const messages: Message[] = toProviderHistory(turn.history).map(({ role, parts }): Message => {
    const text = parts.map((part) => part.text).join("");
    if (role === "user") return { role: "user", content: text, timestamp };
    // Not the current model's api/provider/model: pi-ai replays it as plain text. "stop": pi-ai skips errored turns.
    return { role: "assistant", content: [{ type: "text", text }], api: "history", provider: "history", model: "history", usage: NO_USAGE, stopReason: "stop", timestamp };
  });
  messages.push({ role: "user", content: turn.message, timestamp });
  return { systemPrompt: turn.systemPrompt, messages };
}
```

**Image kit is unaffected.** It imports only the provider packages' main entries (`generate*Image`, the image catalogues), which this ADR does not change. Its peer ranges (`>=0.3.2 <1.0.0` for Google, `>=0.2.0 <1.0.0` for KIE and ToAPIs) accept the new minor versions.

### 9. The planned uses

**LLM API router.**

- Enables: an OpenAI or Anthropic request maps onto a `ChatModelRef` (the router parses its own `model` string), a `Context` (messages, base64 images, tools) and the options (`temperature`, `maxTokens`, `reasoning`, and `toolChoice` or `responseSchema`). pi-ai's events carry everything a response needs: text, thinking, tool calls with ids, the stop reason. The error codes map to HTTP statuses before any byte is sent. `chatKit.usage` gives one record per call, with cost.
- Still lacks, each an added option, a widened union or a loosened check: tools and structured output together (OpenAI and Anthropic APIs allow both in one request, so a router may want them later; allowing it loosens a type and a runtime check, which breaks no caller); forced and named `toolChoice`; sampling parameters (`top_p`, `stop`, `seed`) through pi-ai's `samplingParams`; images by URL and files in place in a message (pi-ai has no such block; the router inlines images, and documents go at the start); `json_object` mode; client-set `cache_control`; batch through pi-ai's `deferred`; the excluded models, through a per-kit opt-in.

**Multi-tenant BYOK service.**

- Enables: one kit per tenant, from that tenant's keys, and one more kit for a second key to the same provider; each key's own live model list; no fallback; the provider's own charge where it reports one (KIE credits, OpenRouter cost). The service records `chatKit.usage` under its downstream key.
- Still lacks, all outside the contract or additive: evicting idle tenant kits (the service's cache); the generic factory for arbitrary compatible resellers (DATA-4580, later); checking a key at registration rather than on first use.

**Multi-tenant BYOK agent platform.**

- Enables: tools and MCP tools, as pi-ai `Tool`s, pass through. The stream is a pi-ai `AssistantMessageEventStream`, so pi-agent-core's loop can run on it through a short `StreamFn` adapter: the pi-ai `Model` it passes is already a `ChatModelRef`. Gem-style documents work per call, and a response schema on a turn without tools. Provider keys stay in the per-tenant kit; tool secrets are the platform's.
- Still lacks, all additive: an exported `StreamFn` adapter; documents placed later than the first user message; long runs through `deferred`. Flows and cron are the platform's.

Nothing in these lists needs a breaking change: each is a new optional option, a widened input union, a loosened check, a new export or a new optional trait.

### 10. Versioning

| Package | Version | Change | Peers |
| --- | --- | --- | --- |
| `@hk01/pi-ai-extra-chat-kit` | 0.3.0 | Breaking: this ADR | `@earendil-works/pi-ai` `1.2.0` (exact); optional: google `>=0.6.0 <1.0.0`, openrouter `>=0.1.0 <1.0.0`, kie `>=0.5.0 <1.0.0`, toapis `>=0.5.0 <1.0.0` |
| `@hk01/pi-ai-extra-google` | 0.6.0 | Additive: `chatKit`, `refreshModels`, `grounding`, `fetch` | `@earendil-works/pi-ai` `1.2.0`, optional, as today |
| `@hk01/pi-ai-extra-kie` | 0.5.0 | Additive: `chatKit`, `refreshModels`, `fetch` | As today |
| `@hk01/pi-ai-extra-toapis` | 0.5.0 | Additive: `chatKit`, `refreshModels`, `fetch` | As today |
| `@hk01/pi-ai-extra-openrouter` | 0.1.0 | New | `@earendil-works/pi-ai` `1.2.0`, required: its only entry is `/pi-ai` |
| `@hk01/pi-ai-extra-image-kit` | No release | — | Unchanged |

The optional peer ranges make a package manager warn about a provider package too old to have `chatKit`; the kit's `TypeError` at registration stops it.

## Decided by the product owner (2026-10-21)

1. DATA-4580's registration contract lands in 0.3.0 (section 1).
2. Tools stay off on KIE and ToAPIs until a live smoke test (section 3).
3. Tools and a response schema are mutually exclusive: the overloads enforce it, and an untyped caller that sends both gets `INVALID_REQUEST` (section 2).
4. The model exclusions stay fixed in 0.3.0; a per-kit opt-in can come later without a break (section 6).
5. Every Chat kit addition to a pi-ai object lives under `chatKit` (Decision).
6. Chat kit identifies a provider by its pi-ai provider id. Consumer-chosen provider names stay in the consumer, which maps them before calling (section 1).
7. The model reference is the object `{ provider, id }`, pi-ai `Model`'s own fields. Parsing a string reference is the consumer's (section 2).
8. Mapping configuration to factories is the consumer's code (section 1).

## Considered options

- **Keep 0.2.0's own types, and map them to pi-ai in each consumer.** Rejected: the router, the BYOK service and the agent platform would each write the mapping, which is what the kits exist to prevent.
- **A separate `result()` shape (`{ message, usage, error }`).** Rejected: the stream would stop being a pi-ai `AssistantMessageEventStream`, so pi-agent-core and pi-ai code could not take it.
- **Put documents and the schema in an extended `ChatContext`.** Rejected: the `Context` would no longer pass through a router untouched, and the product owner decided the extras sit beside it.
- **Keys per call.** Rejected for 0.3.0: model lists belong to a key, and a key passed on every call reaches every call site. It can be added later.
- **Leave registration to DATA-4580.** Rejected: a second breaking release for the same consumers.
- **Keep consumer-chosen provider names in Chat kit.** Rejected by the product owner: naming is a consumer's concern, and pi-ai already identifies a provider by its id.
- **A string model reference (`"<provider>/<model id>"`).** Rejected: it needs a parsing rule (OpenRouter ids contain `/`), and the object is pi-ai `Model`'s own shape. A consumer that stores strings parses them.
- **Allow tools with a response schema.** Rejected by the product owner: tools serve the agent use case and a schema the Gem use case, and on Anthropic Messages without native structured output the forced tool call would block the consumer's tools. Allowing both later breaks no caller.
- **Make the traits Chat kit-internal, looked up by `Provider.id`.** Rejected: a new reseller would again need a Chat kit release, which DATA-4580 exists to stop.

## Consequences

- Chat kit's public types are pi-ai's (`Context`, `AssistantMessage`, `AssistantMessageEvent`, `SimpleStreamOptions`). A breaking pi-ai release is a breaking Chat kit release, so pi-ai stays pinned exactly.
- A new reseller needs a provider package release only, not a Chat kit release.
- Consumers see thinking events and blocks, and decide whether to show them.
- History replay relies on pi-ai's adapters ignoring the `chatKit` member. Chat kit's contract tests replay a message that has it.
- ADR 0008's per-API features, documents, response schema, rates, live-list rules and exclusions stand. Its turn input, events, usage names, error shape and provider registration are replaced here.

## Sources

pi-ai and pi-agent-core at tag `v1.2.0` (`git show v1.2.0:<path>` in `earendil-works/pi`):

- `packages/ai/src/types.ts`: `Context`, `Message`, `UserMessage`, `ImageContent`, `AssistantMessage`, `StopReason`, `Usage`, `AssistantMessageEvent`, `SimpleStreamOptions`, `ToolChoice`, `ProviderRequestOptions.apiKey`, `Tool`, `TranscriptContext`.
- `packages/ai/src/providers/model-schema.ts`: `MODEL_INPUT_MODALITIES` (`text`, `image`), `THINKING_LEVELS`.
- `packages/ai/src/models.ts`: `Provider` (`refreshModels`, `streamSimple`), `Models.streamSimple` and `completeSimple`, `createProvider` (the `fetchModels` merge), `applyAuth` (a per-call `apiKey` wins), `calculateCost`, `getSupportedThinkingLevels`.
- `packages/ai/src/utils/event-stream.ts`: `EventStream.result()`, `AssistantMessageEventStream`, `createAssistantMessageEventStream`.
- `packages/ai/src/api/lazy.ts`: `lazyStream`, a setup failure as a lone `error` event.
- `packages/ai/src/utils/transcript.ts`: `normalizeContext`.
- `packages/ai/src/api/transform-messages.ts`: image placeholders, the same-model check, errored turns skipped.
- `packages/ai/src/api/anthropic-messages.ts`: per-API `toolChoice`, `refusal` and `sensitive` mapped to `error`.
- `packages/ai/src/api/google-shared.ts`: `mapStopReason`, `SAFETY` and the like mapped to `error`.
- `packages/ai/src/api/google-generative-ai.ts`: a custom `fetch` rejected.
- `packages/ai/src/api/openai-completions.ts`: `content_filter` mapped to `error`; `input` excludes cache tokens; `compat.openRouterRouting`.
- `packages/ai/src/providers/openrouter.ts`: `openrouterProvider()`, environment and OAuth auth, no `fetchModels`.
- `packages/ai/scripts/openrouter-catalog.ts`: only models with `tools` in `supported_parameters` enter pi-ai's OpenRouter catalogue.
- `packages/agent/src/types.ts`: pi-agent-core's `StreamFn` returns an `AssistantMessageEventStream`.
