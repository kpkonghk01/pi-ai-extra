# ADR 0009: Align the Chat kit 0.3.0 contract with pi-ai

- Status: Accepted
- Date: 2026-10-21
- Related: [ADR 0001](0001-registry-free-package-releases.md), [ADR 0002](0002-dual-layer-provider-contract.md), [ADR 0003](0003-explicit-provider-execution.md), [ADR 0004](0004-dual-format-helper-esm-pi-ai-subpath.md), [ADR 0005](0005-provider-reported-usage.md), [ADR 0008](0008-chat-kit-package.md) (amended), data-gen-ai-portal ADR 0010, [DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583), [DATA-4580](https://hk01-digital.atlassian.net/browse/DATA-4580), [DATA-4564](https://hk01-digital.atlassian.net/browse/DATA-4564)

## Context

pi-ai-extra extends pi-ai: it adds providers or extends existing ones, and reuses pi-ai's types, names and mechanisms. Chat kit's role is to register the providers a consumer application builds from its configuration (keys) with the provider packages' factories, to offer one interface for calling LLMs, and to route each call by its model reference to the matching provider. The portal is its first consumer; Google AI Studio apps may adopt it too.

Chat kit 0.2.0 is not yet in production, and it does not reuse pi-ai: it has its own turn input, events, setting and usage names, and a closed list of provider kinds. The contract must also serve three planned uses ([DATA-4564](https://hk01-digital.atlassian.net/browse/DATA-4564)): an internal LLM API router with OpenAI- and Anthropic-compatible endpoints, a multi-tenant BYOK service with usage recorded per downstream key, and a multi-tenant BYOK agent platform with tools, MCP, flows and cron.

pi-ai 1.2.0 lacks what Chat kit adds: a document block (`UserMessage.content` takes only text and base64 `ImageContent`); a response-format option; a blocked stop reason (a safety stop is `stopReason: "error"`, and a Gemini prompt-level block is not reported at all); optional usage counts (every `Usage` count except `reasoning` and `cacheWrite1h` is required, and set to 0 when unreported); a `file` model input (`ModelInputModality` is `text | image`); and capability, rate or cost-policy data on a `Provider` or `Model`. pi-ai also replaces an image with placeholder text when the model has no image input. Chat kit refuses such a turn instead. ADR 0003 forbids silently discarding reference images over a model's limit, and Chat kit holds chat input to the same standard.

## Decision

The product owner decided, on 2026-10-21:

1. One breaking change, now: the whole contract changes in chat-kit 0.3.0.
2. The turn input is pi-ai's `Context`. Documents and the response schema sit beside it.
3. Settings, events, usage counts and model info use pi-ai's names. Errors keep Chat kit's codes, except that an abort is `stopReason: "aborted"`, not a code.
4. Chat kit keeps the extras pi-ai lacks: documents, the response schema, error codes, provider-reported and estimated cost, dated rates, and model-list freshness.
5. A new `@hk01/pi-ai-extra-openrouter` extends pi-ai's built-in `openrouter` provider; it does not replace it.
6. DATA-4580's registration contract lands in 0.3.0.
7. Chat kit knows a provider by its pi-ai id. The consumer keeps its own provider names and its own mapping from configuration to factories.
8. The model reference is `{ provider, id }`: the same fields as pi-ai's `Model`.
9. Every Chat kit addition to a pi-ai object sits under one member, `chatKit`. It is not named `chat`, which reads like a verb or a method.
10. BYOK: one kit per tenant. Per-call keys could come later without a break.
11. `listModels()` returns pi-ai `Model`s, with Chat kit's extras under `chatKit`.
12. Tools and a response schema are mutually exclusive: tools serve the agent use case, a response schema the Gem use case.
13. Tools stay off on KIE and ToAPIs until a live smoke test.
14. ADR 0008's model exclusions stay fixed in 0.3.0.

### 1. Providers

```ts
// Defined once in the internal package; exported by each provider package's /pi-ai entry and by Chat kit.
export type ChatProvider<TApi extends Api = Api> = Provider<TApi> & { readonly chatKit: ChatProviderTraits };

export interface ChatProviderTraits {
  /** What the provider takes; each is off until documented or verified live. */
  readonly takes: { readonly fileDocuments: boolean; readonly tools: boolean; readonly nativeStructuredOutput: boolean };
  offers(model: Model<Api>): boolean; // ADR 0008's exclusions
  /** What a model can do that pi-ai's `Model` has no field for. */
  describe(model: Model<Api>): { fileInput: boolean; toolSupport: boolean; rate?: ModelRate };
  reportedCostUsd(raw: Record<string, unknown>): number | undefined; // the provider's own charge, in USD
  readonly estimatesCost: boolean; // a turn without a reported charge is estimated from the Model rate
}

export function createChatKit(options: { providers: readonly ChatProvider[]; fetch?: typeof globalThis.fetch }): ChatKit;
```

A chat provider is still a pi-ai `Provider`; plain pi-ai code ignores `chatKit`. A trait added later is optional and defaults to off. Each provider package keeps one factory (ADR 0002), which now returns a chat provider:

| Factory (`/pi-ai`) | Live list (`refreshModels`) | `takes`: documents, tools, native structured output | Cost |
| --- | --- | --- | --- |
| `createGoogleProvider` (new: `grounding?`, `fetch?`) | `models.list` | Yes, yes, — | Estimated |
| `createOpenRouterProvider({ apiKey, baseUrl?, fetch? })` (new package) | Public `/models` | Yes, yes (`toolSupport` from `supported_parameters`), yes | `usage.cost`, else estimated |
| `createKieProvider` (new: `fetch?`) | Codex and Claude lists, intersected with the definitions | Not yet, not yet, yes | `credits_consumed` × $0.005, never estimated |
| `createToapisProvider` (new: `fetch?`) | `/v1/models?type=text`, intersected with the definitions | Not yet, not yet, not yet | Estimated |

- **OpenRouter factory.** It keeps pi-ai's `openrouter` id, catalogue, adapters, and image and classifier models. It replaces only the auth (the explicit key, instead of `OPENROUTER_API_KEY` and OAuth) and adds the live list and `chatKit`.
- **Google factory.** It wraps its streams to add the grounding tools through `onPayload`, and copies `promptFeedback.blockReason` to `rawStopReason`.
- **Live lists.** A live list is the provider's `refreshModels`, so `models.refresh()` reads it for any pi-ai consumer. It replaces the list, so a model the provider drops disappears; pi-ai's `createProvider({ fetchModels })` merges over the baseline and never removes one. Chat kit keeps ADR 0008's freshness rules.
- **Registration.** Chat kit registers each provider by `provider.id`, in one pi-ai `Models` collection with an empty auth context. pi-ai's `setProvider()` silently replaces a provider with the same id, so Chat kit throws a `TypeError` on a duplicate id, and on a provider without `chatKit`.
- **Keys and configuration.** Keys, base URLs and grounding go to the factories, so Chat kit never handles a key (ADR 0003). Mapping configuration to factories is the consumer's code. An optional helper that takes the consumer's own factory table could be added later without a break.
- **BYOK.** One kit per tenant means two keys for the same provider are two kits. A chat provider binds one key, which is ADR 0003's attribution and no-fallback boundary. Gemini, KIE and ToAPIs read their model lists with the key, so those lists can differ by account. A kit holds no timers between calls, so it needs no `dispose()`.
- **What stays in Chat kit, per wire API:** documents, the response schema, reading usage from the provider's own record, blocked classification, HTTP status capture, and the always-thinking Claude rule. The cost estimated from the Model rate uses pi-ai's `calculateCost`, and OpenRouter's `require_parameters` goes through `compat.openRouterRouting`.
- **What remains of DATA-4580**, none of it public: the key-gated smoke script (now also checking tool calls), the "Adding a reseller" checklist, moving each provider's quirk code from the internal package into its own package, and later a generic reseller factory.

### 2. Turn

```ts
export interface ChatKit {
  /** A tool-free turn, which may carry a response schema (a Gem turn). */
  streamSimple(model: ChatModelRef, context: ChatToolFreeContext, options?: ChatSchemaStreamOptions): ChatTurnStream;
  /** A turn that may carry tools and has no response schema (an agent turn). */
  streamSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): ChatTurnStream;
  completeSimple(model: ChatModelRef, context: ChatToolFreeContext, options?: ChatSchemaStreamOptions): Promise<ChatAssistantMessage>;
  completeSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): Promise<ChatAssistantMessage>;
  listModels(options?: { signal?: AbortSignal }): Promise<ChatProviderModels[]>;
}

export type ChatModelRef = Pick<Model<Api>, "provider" | "id">; // provider: pi-ai's ProviderId
type ChatBaseOptions = Pick<SimpleStreamOptions, "signal" | "temperature" | "maxTokens" | "reasoning" | "sessionId" | "maxRetries"> & {
  documents?: readonly ChatDocument[]; // they open the first user message, so prompt caching covers them
};
export type ChatStreamOptions = ChatBaseOptions & Pick<SimpleStreamOptions, "toolChoice"> & { responseSchema?: undefined };
export type ChatSchemaStreamOptions = ChatBaseOptions & { responseSchema?: ChatResponseSchema };
export type ChatToolFreeContext = Omit<Context, "tools"> & { tools?: undefined };
```

- **Calls.** They mirror pi-ai's `Models.streamSimple()` and `completeSimple()`; `completeSimple()` is `streamSimple(...).result()`. The names `stream()` and `complete()` stay free for a later variant with per-API options.
- **Model reference.** A pi-ai `Model` is a valid reference. Chat kit resolves the reference against its own model list. Parsing a string such as `"google/gemini-3.5-flash"` is the consumer's job.
- **Context.** `context` is pi-ai's `Context`, unextended; a pi-ai `TranscriptContext` fits too. `ChatDocument` and `ChatResponseSchema` are unchanged from 0.2.0.
- **Tools or a schema.** The first overload takes a tool-free context and an optional schema, so a Gem helper that returns a `ChatToolFreeContext` also covers a turn whose schema is conditional. The second takes tools and no schema. An untyped caller that sends both gets `INVALID_REQUEST` before anything is sent. The check reads the normalized transcript, so a system message's `toolsAdded` counts; an empty `tools` array counts as none.
- **Tools.** Tools, tool calls and tool results pass through to pi-ai. Before sending, Chat kit refuses tools with `UNSUPPORTED` when `chatKit.takes.tools` is false or the model lacks `toolSupport`. `toolChoice` is pi-ai's `"auto" | "none"`.
- **Response schema.** It keeps 0.2.0's rules. On Anthropic Messages without native structured output it is still a forced tool call; Chat kit turns that call into `text_*` events, a text block and `stopReason: "stop"`.
- **Settings.** Without `reasoning`, thinking is off where the model allows it, as in pi-ai. `maxRetries` defaults to 2, and retries happen only before the stream starts. `cacheRetention` is fixed at `"short"`, because the cost estimated from the Model rate prices an unpublished cache-write rate as a 5-minute write.

### 3. Output and errors

```ts
export interface ChatTurnStream extends AssistantMessageEventStream { result(): Promise<ChatAssistantMessage> }
export type ChatAssistantMessage = AssistantMessage & (
  | { stopReason: "error"; chatKit: { usage?: ChatUsage; error: ChatTurnError } }
  | { stopReason: Exclude<StopReason, "error">; chatKit: { usage?: ChatUsage; error?: undefined } }
);
export type ChatTurnErrorCode = "CONTENT_BLOCKED" | "PROVIDER_ERROR" | "UNSUPPORTED" | "UNKNOWN_MODEL" | "INVALID_REQUEST";
export interface ChatTurnError { code: ChatTurnErrorCode; status?: number } // status: HTTP status of the provider's error response
```

Events are pi-ai's, passed through, except that a forced schema tool call becomes text and a turn Chat kit fails ends with its own `error` event. The record sits on the final message because the stream then stays a real `AssistantMessageEventStream`, which pi-agent-core and SSE translators take; pi-ai already keeps per-response metadata there; and the message goes back into `Context.messages` unchanged. `message.provider`, `api` and `model` stay pi-ai's, because pi-ai replays thinking and Gemini thought signatures only for the same model.

On that message, `rawStopReason` holds the provider's stop or block reason, and `errorMessage` starts with `[provider/model]`. An answer cut off at `maxTokens` ends `stopReason: "length"`. A response-schema answer cut off there cannot be parsed, so it fails with `PROVIDER_ERROR`. `message.usage` is pi-ai's, zero-filled; Usage records read `chatKit.usage`.

| Code | When | Sent? |
| --- | --- | --- |
| `UNKNOWN_MODEL` | No provider has that id, or the model is not offered | No |
| `UNSUPPORTED` | The model or provider cannot take the turn's documents, images, tools, schema or settings | No |
| `INVALID_REQUEST` | Malformed input, both tools and a schema, or a document whose `load()` failed | No |
| `CONTENT_BLOCKED` | A safety system blocked the prompt or answer; `rawStopReason` is the provider's value | Yes |
| `PROVIDER_ERROR` | The provider failed | Yes |

A failure before sending ends the stream with a lone `error` event and no `start`, as pi-ai's `lazyStream` ends a setup failure. Nothing is thrown, and `completeSimple()` never rejects. For a model that did not resolve, `api` is `"unknown"`, and `provider` and `model` are the reference's. A new code may come in a minor release; consumers treat an unknown code as `PROVIDER_ERROR`.

```ts
const stream = chat.streamSimple({ provider: "google", id: "gemini-3.5-flash" }, gemContext, { documents, responseSchema });
for await (const event of stream) if (event.type === "text_delta") res.write(event.delta);
const message = await stream.result();
if (message.stopReason === "error") showError(message.chatKit.error.code, message.rawStopReason);
```

### 4. Usage and cost

```ts
/** A turn's Usage record (ADR 0005), with pi-ai's count names. A count is present only when the provider reported it. */
export interface ChatUsage {
  input?: number; // the reported prompt count minus the reported cache counts; left out if negative
  output?: number; // every generated token, reasoning included
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number; // part of output
  totalTokens?: number; // the provider's own total; never computed, so Anthropic Messages has none
  costUsd?: number;
  costSource?: "provider" | "estimated";
  raw: Record<string, unknown>;
}
```

The record sits beside pi-ai's `Usage`, which cannot leave a count out. `input` changes meaning: 0.2.0's `inputTokens` included cache tokens, and the whole prompt is now `input + cacheRead + cacheWrite`. The cost order is unchanged: the provider's own charge, else the cost estimated from the Model rate in force when the turn started (pi-ai's `calculateCost`, with ADR 0005's derived cache rates), else none.

### 5. Model listing

```ts
export type ChatModel = Model<Api> & { chatKit: ChatModelTraits }; // also its own ChatModelRef
export interface ChatModelTraits {
  fileInput: boolean; // reads PDFs natively; pi-ai's input has only text and image
  fileDocuments: boolean; // a turn may send PDF and image documents: the provider takes them, the model reads both
  tools: boolean; // a turn may send Context.tools: the provider takes them, the model supports them
  responseSchema: boolean; // a tool-free turn without a reasoning level may carry a schema
  rate?: RatePeriod; // the rate in force now; absent when the model has none, never a zero rate
}
export type ChatProviderModels =
  | { provider: ProviderId; source: "live" | "installed"; fetchedAt?: string; refreshError?: string; models: ChatModel[] }
  | { provider: ProviderId; error: string };
```

Everything else is pi-ai's own `Model`: `id`, `name`, `api`, `input`, `contextWindow`, `maxTokens` and `reasoning`. Thinking levels come from pi-ai's `getSupportedThinkingLevels(model)`. `Model.cost` stays pi-ai's, with zeros for a model without a rate; the rate is `chatKit.rate`.

### 6. Migration

| 0.2.0 | 0.3.0 |
| --- | --- |
| `createChatKit({ providers: ChatProviderConfig[] })`, where a config is `{ name, provider, apiKey, baseUrl?, grounding? }`; `ChatProviderKind` | `createChatKit({ providers: ChatProvider[] })`. The factories take the key, base URL and grounding. pi-ai's `Provider.id` replaces the kind. `name` stays in the consumer |
| `runTurn(input, options)` | `streamSimple(model, context, options)`, `completeSimple(...)` |
| `ChatTurnInput.provider` (the consumer's name), `.model` | `ChatModelRef.provider` (the pi-ai id), `.id` |
| `.systemPrompt`, `.history`, `.message`; `ChatHistoryMessage` | `Context.systemPrompt`, `Context.messages` |
| `.documents` (required), `.responseSchema` | The `documents` option (optional); `responseSchema` with a `ChatToolFreeContext` |
| `ChatTurnSettings { temperature, maxOutputTokens, reasoning }`, `ChatTurnOptions { signal }` | Options `temperature`, `maxTokens`, `reasoning`, `signal`. New options: `toolChoice`, `sessionId`, `maxRetries` |
| Events `text`, `done { usage?, truncated? }`, `failed` | pi-ai's `text_delta`, `done { reason }`, `error { reason }`, plus thinking and tool-call events. `truncated` is now `stopReason: "length"` |
| `ChatTurnError { code, provider, model, message, reason?, status? }`; code `ABORTED` | `chatKit.error { code, status? }`, plus `message.provider`, `.model`, `.errorMessage`, `.rawStopReason`; `stopReason: "aborted"` |
| `usage`: `inputTokens` (cache included), `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens` | `chatKit.usage`: `input` (cache excluded), `output`, `cacheRead`, `cacheWrite`, `reasoning` |
| `ChatModelInfo` (`maxOutputTokens`, `input` with `file`); `ChatModelInput` | `ChatModel`: a pi-ai `Model`, plus `chatKit { fileInput, fileDocuments, tools, responseSchema, rate? }` |
| `ChatProviderModels.provider` (the consumer's name), `.kind` | `provider` (the pi-ai id) |

Unchanged: `ChatDocument`, `ChatResponseSchema`, the rate types, and `totalTokens`, `costUsd`, `costSource` and `raw`. For a consumer, what changes is registration (factories and pi-ai ids), the turn call (reference, `Context` and options), the final message, the usage names and the listed models; the portal writes its own migration sketch when it adopts 0.3.0 under DATA-4583. Image kit is unaffected: it imports only the provider packages' main entries, and its peer ranges accept the new minor versions.

### 7. The planned uses

- **Router.** It parses its own `model` string into a reference and maps a request onto a `Context` and the options. pi-ai's events carry everything a response needs, and error codes map to HTTP statuses before any byte is sent. Still missing: tools together with structured output, which OpenAI and Anthropic allow; forced and named `toolChoice`; sampling parameters (pi-ai applies `samplingParams` only on OpenAI-compatible APIs); images by URL and files placed inside a message; `json_object` mode; client-set `cache_control`; batches through pi-ai's `deferred`; and the excluded models.
- **BYOK service.** One kit per tenant gives each key its own model lists, no fallback, and the provider's own charge where it reports one. Still missing: idle-kit eviction (the service's own job), a generic reseller factory, and a key check at registration.
- **Agent platform.** Tools and MCP tools pass through as pi-ai `Tool`s. pi-agent-core's `StreamFn` returns an `AssistantMessageEventStream` (or a Promise of one), and the `Model` it receives is a `ChatModelRef`, so a short adapter fits. Still missing: an exported adapter, documents placed later than the first user message, and runs through `deferred`.

Each missing item can be added without breaking callers: as a new optional option, a widened union, a loosened check, a new export or a new optional trait. There are two exceptions. A new overload or a required member still breaks an implementer of `ChatKit`, such as a test fake or a proxy. And pi-ai's types are part of the public contract, pinned exactly, so a breaking pi-ai release is a breaking Chat kit release.

### 8. Versioning

| Package | Version | Peers |
| --- | --- | --- |
| `@hk01/pi-ai-extra-chat-kit` | 0.3.0, breaking | pi-ai `1.2.0` exact. Optional peers: google `>=0.6.0 <1.0.0`, openrouter `>=0.1.0 <1.0.0`, kie and toapis `>=0.5.0 <1.0.0` |
| `@hk01/pi-ai-extra-google` | 0.6.0, additive: `chatKit`, `refreshModels`, `grounding`, `fetch` | As today |
| `@hk01/pi-ai-extra-kie`, `-toapis` | 0.5.0, additive: `chatKit`, `refreshModels`, `fetch` | As today |
| `@hk01/pi-ai-extra-openrouter` | 0.1.0, new, released from `openrouter-vX.Y.Z` (ADR 0001) | pi-ai `1.2.0` exact, required |

The OpenRouter package has only a `/pi-ai` entry, an exception to ADR 0002 and ADR 0004 (both amended). The optional peer ranges make a package manager warn about a provider package too old to have `chatKit`; Chat kit's `TypeError` at registration stops it.

## Considered options

- **Keep 0.2.0's types and map them to pi-ai in each consumer.** Rejected: every planned use would write the same mapping.
- **A separate `result()` shape, or a `ChatModelInfo` projection.** Rejected: they replace pi-ai's types instead of reusing them, and pi-agent-core could not take the stream.
- **Extras inside an extended `Context`.** Rejected: a router could no longer pass the `Context` through untouched.
- **Keys per call, consumer-chosen provider names, or a string model reference.** Rejected. A chat provider binds its key; naming is the consumer's concern; and a string needs a parsing rule, since OpenRouter ids contain `/`.
- **Tools with a response schema.** Rejected for now. Allowing it later only loosens a type and a runtime check.
- **Traits inside Chat kit, looked up by `Provider.id`.** Rejected: each new reseller would again need a Chat kit release.

## Consequences

- A new reseller needs only a provider package release, not a Chat kit release.
- Consumers see thinking events and blocks, and decide whether to show them.
- History replay relies on pi-ai's adapters ignoring `chatKit` members. Chat kit's contract tests replay a message that has one.
- ADR 0008's per-API features, documents, response schema, rates, live-list rules and exclusions stand. Its turn input, events, usage names, error shape and registration are replaced.

## Sources

pi-ai and pi-agent-core at tag `v1.2.0`: `packages/ai/src/` `types.ts`, `models.ts`, `providers/model-schema.ts`, `providers/openrouter.ts`, `utils/event-stream.ts`, `api/lazy.ts`, `api/transform-messages.ts`, `api/anthropic-messages.ts`, `api/google-shared.ts` and `api/openai-completions.ts`; `packages/ai/scripts/openrouter-catalog.ts`; `packages/agent/src/types.ts`.
