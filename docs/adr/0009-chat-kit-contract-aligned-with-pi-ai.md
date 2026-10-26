# ADR 0009: Align the chat kit 0.3.0 contract with pi-ai

- Status: Accepted
- Date: 2026-10-21
- Related: [ADR 0001](0001-registry-free-package-releases.md), [ADR 0002](0002-dual-layer-provider-contract.md), [ADR 0003](0003-explicit-provider-execution.md), [ADR 0004](0004-dual-format-helper-esm-pi-ai-subpath.md), [ADR 0005](0005-provider-reported-usage.md), [ADR 0008](0008-chat-kit-package.md) (amended), data-gen-ai-portal ADR 0010, [DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583), [DATA-4580](https://hk01-digital.atlassian.net/browse/DATA-4580), [DATA-4564](https://hk01-digital.atlassian.net/browse/DATA-4564)

## Context

pi-ai-extra extends pi-ai: it adds providers or extends existing ones, and reuses pi-ai's types, names and mechanisms. The chat kit's role is to register the providers a consumer application builds from its configuration (keys) with the provider packages' factories, to offer one interface for calling LLMs, and to route each call by its model reference to the matching provider. The portal is its first consumer; Google AI Studio apps may adopt it too.

chat-kit 0.2.0, not yet in production, does not reuse pi-ai: it has its own turn input, events, setting and usage names, and a closed list of provider kinds. The contract must also serve three planned uses ([DATA-4564](https://hk01-digital.atlassian.net/browse/DATA-4564)): an internal LLM API router, a multi-tenant BYOK service and a multi-tenant BYOK agent platform.

pi-ai 1.2.0 lacks what the chat kit adds: a document block (`UserMessage.content` takes only text and base64 `ImageContent`); a response-format option; a blocked stop reason (a safety stop is `stopReason: "error"`, and a Gemini prompt-level block is not reported at all); optional usage counts (every `Usage` count except `reasoning` and `cacheWrite1h` is required, and set to 0 when unreported); a `file` model input; and capability, rate or cost-policy data on a `Provider` or `Model`. pi-ai also replaces an image with placeholder text for a model without image input. The chat kit refuses such a turn instead: ADR 0003 forbids silently discarding reference images over a model's limit, and the chat kit holds chat input to the same standard.

## Decision

The product owner decided, on 2026-10-21:

1. One breaking change, now: the whole contract changes in chat-kit 0.3.0.
2. The turn input is pi-ai's `Context`. Documents and the response schema sit beside it.
3. Settings, events, usage counts and model info use pi-ai's names. Errors keep the chat kit's codes.
4. The chat kit keeps the extras pi-ai lacks: documents, the response schema, its error codes, usage counts that are only what the provider reported (never zero-filled), provider-reported and estimated cost, dated rates, and model-list freshness.
5. A new `@hk01/pi-ai-extra-openrouter` package extends pi-ai's built-in `openrouter` provider. It does not replace it.
6. DATA-4580's registration contract lands in 0.3.0.
7. The chat kit knows a provider by its pi-ai id. The consumer keeps its own provider names, and its own mapping from configuration to factories.
8. The model reference is `{ provider, id }`, the same fields as pi-ai's `Model`.
9. Every chat kit addition to a pi-ai object sits under one member, `chatKit`. It is not called `chat`, because that reads like a verb or a method.
10. BYOK: one kit per tenant. Per-call keys could come later without a break.
11. `listModels()` returns pi-ai `Model`s, with the chat kit's extras under `chatKit`.
12. Declared tools and a response schema are mutually exclusive. Tools serve the agent use case; a response schema serves the Gem use case. A conversation that holds tool calls or results without declaring tools is not "declared tools" (see the 2026-10-26 amendment).
13. Tools stay off on KIE and ToAPIs until a live smoke test.
14. ADR 0008's model exclusions stay fixed in 0.3.0.

### 1. Providers

```ts
export type ChatProvider<TApi extends Api = Api> = Provider<TApi> & { readonly chatKit: ChatProviderTraits };

export interface ChatProviderTraits {
  /** Provider level: what the provider takes. Each is off until documented or verified live. */
  readonly takes: { readonly fileDocuments: boolean; readonly tools: boolean; readonly nativeStructuredOutput: boolean };
  offers(model: Model<Api>): boolean; // ADR 0008's exclusions
  describe(model: Model<Api>): { fileInput: boolean; tools: boolean; rate?: ModelRate | undefined }; // model level: what the model itself can do
  reportedCostUsd(raw: Record<string, unknown>): number | undefined; // the provider's own charge, in USD
  readonly estimatesCost: boolean; // a turn without a reported charge is estimated from the Model rate
  readonly fetch?: typeof globalThis.fetch | undefined; // the factory's `fetch` option: a turn goes through it unless the kit has its own (not Google's: pi-ai's Gemini adapter rejects a custom fetch)
}

export function createChatKit(options: { providers: readonly ChatProvider[]; fetch?: typeof globalThis.fetch | undefined }): ChatKit;
```

These types are defined once in the internal package and exported by each provider package's `/pi-ai` entry and by the chat kit. A chat provider is still a pi-ai `Provider`, and plain pi-ai code ignores `chatKit`. A trait added later is optional and off by default. Each provider package keeps one factory (ADR 0002), and that factory now returns a chat provider:

| Factory (`/pi-ai`) | Live list (`refreshModels`) | `takes`: documents, tools, native structured output | Cost |
| --- | --- | --- | --- |
| `createGoogleProvider` (new: `grounding?`, `fetch?`) | `models.list` | Yes, yes, — | Estimated |
| `createOpenRouterProvider({ apiKey, baseUrl?, fetch? })` (new package) | Public `/models` | Yes, yes, yes | `usage.cost`, else estimated |
| `createKieProvider` (new: `fetch?`) | Codex and Claude lists, intersected with the definitions | Not yet, not yet, yes | `credits_consumed` × $0.005, never estimated |
| `createToapisProvider` (new: `fetch?`) | `/v1/models?type=text`, intersected with the definitions | Not yet, not yet, not yet | Estimated |

- **OpenRouter factory.** It keeps pi-ai's `openrouter` id, catalogue, adapters, and image and classifier models. It replaces only the auth: an explicit key instead of `OPENROUTER_API_KEY` and OAuth. It reads the public `/models`, which carries the modality, router and parameter data that the exclusions and `describe()` need; per-model `tools` comes from `supported_parameters`. pi-ai exports `personalizeOpenRouterCatalog`, which narrows a catalogue to the key's `/models/user`. A BYOK kit may apply it later without a break.
- **Google factory.** It wraps its streams to add the grounding tools through `onPayload`, and copies `promptFeedback.blockReason` to `rawStopReason`.
- **Live lists.** A live list is the provider's `refreshModels`, so `models.refresh()` reads it for any pi-ai consumer. It replaces the list, so a model the provider drops disappears. pi-ai's `createProvider({ fetchModels })` would merge over the baseline instead, and never remove a model. The chat kit keeps ADR 0008's freshness rules.
- **Registration.** The chat kit registers each provider by `provider.id`, in one pi-ai `Models` collection with an empty auth context. pi-ai's `setProvider()` silently replaces a provider with the same id, so the chat kit throws a `TypeError` on a duplicate id instead. It also throws one for a provider without `chatKit`. Keys, base URLs and grounding go to the factories, so the chat kit never handles a key (ADR 0003); an optional helper that takes the consumer's own factory table could be added later without a break.
- **Per tenant.** Two keys for the same provider are two kits, because a chat provider binds one key, ADR 0003's attribution and no-fallback boundary. A kit has no timers of its own between calls, so it needs no `dispose()`: a model-list read (the background refresh of a stale list, or a first read whose caller stopped waiting) may run for up to 15 s after a call, under an unref'd deadline timer; the request in flight is not unref'd, so it keeps a process alive until it ends.
- **Per wire API, the chat kit keeps** documents, the response schema, reading usage from the provider's own record, blocked classification, HTTP status capture and the always-thinking Claude rule. The estimate from the Model rate uses pi-ai's `calculateCost`; OpenRouter's `require_parameters` goes through `compat.openRouterRouting`.
- **What remains of DATA-4580**, none of it public: the key-gated smoke script (now also checking tool calls), the "Adding a reseller" checklist, moving each provider's quirk code from the internal package into its own package, and later a generic reseller factory.

### 2. Turn

```ts
export interface ChatKit {
  streamSimple(model: ChatModelRef, context: ChatToolFreeContext, options?: ChatSchemaStreamOptions): ChatTurnStream; // Gem turn
  streamSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): ChatTurnStream; // agent turn
  completeSimple(model: ChatModelRef, context: ChatToolFreeContext, options?: ChatSchemaStreamOptions): Promise<ChatAssistantMessage>;
  completeSimple(model: ChatModelRef, context: Context, options?: ChatStreamOptions): Promise<ChatAssistantMessage>;
  listModels(options?: { signal?: AbortSignal | undefined }): Promise<ChatProviderModels[]>;
}

export type ChatModelRef = Pick<Model<Api>, "provider" | "id">; // provider: pi-ai's ProviderId
type Optional<T> = { [K in keyof T]?: T[K] | undefined };
type ChatBaseOptions = Optional<
  Pick<SimpleStreamOptions, "signal" | "temperature" | "maxTokens" | "reasoning" | "sessionId" | "maxRetries"> & { documents: readonly ChatDocument[] }
>;
export type ChatStreamOptions = ChatBaseOptions & Optional<Pick<SimpleStreamOptions, "toolChoice">> & { responseSchema?: undefined };
export type ChatSchemaStreamOptions = ChatBaseOptions & Optional<{ responseSchema: ChatResponseSchema }>;
export type ChatToolFreeContext = Omit<Context, "tools"> & { tools?: undefined };
```

- **Calls.** They mirror pi-ai's `Models.streamSimple()` and `completeSimple()`; `completeSimple()` is `streamSimple(...).result()`. The names `stream()` and `complete()` stay free for a later variant with per-API options. Every optional option member also accepts `undefined`, because consumers may compile with `exactOptionalPropertyTypes`.
- **Reference and context.** A pi-ai `Model` is a valid reference; the chat kit resolves it against its own model list, and parsing a string such as `"google/gemini-3.5-flash"` is the consumer's job. `context` is pi-ai's `Context`, unextended. Documents open the first user message, so provider prompt caching covers them. `ChatDocument` and `ChatResponseSchema` are unchanged from 0.2.0.
- **Which overload.** The first takes a tool-free context and an optional schema, so a function that builds a Gem's turn and returns a `ChatToolFreeContext` also covers a schema that may be absent (`responseSchema: maybeSchema`). The second takes tools and no schema. A pi-ai `TranscriptContext` carries its tools in a system message's `toolsAdded`, not in `tools`, so it satisfies `ChatToolFreeContext` and a pi-agent-core `StreamFn` adapter resolves to the first overload. The runtime check catches what the types cannot: it reads the normalized transcript, and a turn with both tools and a schema, from such a context or an untyped caller, gets `INVALID_REQUEST` before anything is sent. An empty `tools` array counts as none.
- **Tools.** Tools, tool calls and tool results pass through to pi-ai. Before sending, the chat kit refuses a turn that carries tools, tool calls or tool results with `UNSUPPORTED` when `takes.tools` or `describe(model).tools` is false. `toolChoice` is pi-ai's `"auto" | "none"`. The response schema keeps 0.2.0's rules. On Anthropic Messages without native structured output it is still a forced tool call. The chat kit turns that call into `text_*` events, a text block and `stopReason: "stop"`.
- **Settings.** Without `reasoning`, thinking is off where the model allows it, as in pi-ai. `maxRetries` defaults to 2 and retries only before the stream starts. `cacheRetention` is fixed at `"short"`, because the estimate from the Model rate prices an unpublished cache-write rate as a 5-minute write.

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

Events are pi-ai's, passed through, except that a forced schema tool call becomes text and a turn the chat kit fails ends with its own `error` event. The record sits on the final message because the stream then stays a real `AssistantMessageEventStream`, which pi-agent-core and SSE translators take; pi-ai already keeps per-response metadata there; and the message goes back into `Context.messages` unchanged. `message.provider`, `api` and `model` stay pi-ai's, because pi-ai replays thinking and Gemini thought signatures only for the same model. `rawStopReason` holds the provider's stop or block reason, and `errorMessage` starts with `[provider/model]`. An abort is pi-ai's `stopReason: "aborted"`, with no `chatKit.error`; 0.2.0's `ABORTED` code is gone. An answer cut off at `maxTokens` ends `stopReason: "length"`, but a response-schema answer cut off there cannot be parsed, so it fails with `PROVIDER_ERROR`. `message.usage` is pi-ai's, zero-filled; Usage records read `chatKit.usage`.

| Code | When | Sent? |
| --- | --- | --- |
| `UNKNOWN_MODEL` | No provider has that id, or the model is not offered | No |
| `UNSUPPORTED` | The model or provider cannot take the turn's documents, images, tools, schema or settings | No |
| `INVALID_REQUEST` | Malformed input (a message the kit cannot read, for example), a response schema together with declared tools, or a document whose `load()` failed | No |
| `CONTENT_BLOCKED` | A safety system blocked the prompt or the answer; `rawStopReason` is the provider's value | Yes |
| `PROVIDER_ERROR` | The provider failed | Yes |

A failure before sending ends the stream with a lone `error` event and no `start`, the way pi-ai's `lazyStream` ends a setup failure. Nothing is thrown, and `completeSimple()` never rejects. For a model that did not resolve, `api` is `"unknown"`, and `provider` and `model` come from the reference. A new code may come in a minor release, so consumers treat an unknown code as `PROVIDER_ERROR`.

```ts
const stream = chat.streamSimple({ provider: "google", id: "gemini-3.5-flash" }, gemContext, { documents, responseSchema: maybeSchema });
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
  cacheRead?: number; cacheWrite?: number; reasoning?: number; // reasoning is part of output
  totalTokens?: number; // the provider's own total; never computed, so Anthropic Messages has none
  costUsd?: number; costSource?: "provider" | "estimated";
  raw: Record<string, unknown>;
}
```

The record sits beside pi-ai's `Usage`, which cannot leave a count out. `input` changes meaning: 0.2.0's `inputTokens` included cache tokens, and the whole prompt is now `input + cacheRead + cacheWrite`. The cost order is unchanged: the provider's own charge, else the estimate from the Model rate in force when the turn started (pi-ai's `calculateCost`, with ADR 0005's derived cache rates), else none.

### 5. Model listing

```ts
export type ChatModel = Model<Api> & { chatKit: ChatModelTraits }; // also its own ChatModelRef
export interface ChatModelTraits {
  fileInput: boolean; // describe(model).fileInput: reads PDFs natively; pi-ai's input has only text and image
  fileDocuments: boolean; // a turn may send this model PDF and image documents: takes.fileDocuments, and it reads both
  tools: boolean; // a turn may send this model Context.tools: takes.tools and describe(model).tools
  responseSchema: boolean; // for a turn without reasoning; with a reasoning level, a schema may still be UNSUPPORTED
  rate?: ModelRate | undefined; // describe(model).rate, the dated schedule; absent when the model has none, never a zero rate
}
export type ChatProviderModels =
  | { provider: ProviderId; source: "live" | "installed"; fetchedAt?: string; refreshError?: string; models: ChatModel[] }
  | { provider: ProviderId; error: string };
```

Everything else is pi-ai's own `Model`: `id`, `name`, `api`, `input`, `contextWindow`, `maxTokens` and `reasoning`. Thinking levels come from pi-ai's `getSupportedThinkingLevels(model)`. `Model.cost` stays pi-ai's: the rate period in force when the provider was created, with zeros for a model without a rate. It goes stale in a long-running process after a scheduled change, so a consumer reads the price from `chatKit.rate`, which the kit also prices each turn from.

### 6. Migration

| 0.2.0 | 0.3.0 |
| --- | --- |
| `createChatKit({ providers: ChatProviderConfig[] })`; `ChatProviderKind` | `createChatKit({ providers: ChatProvider[] })`: the factories take the key, base URL and grounding, and the pi-ai id replaces the kind. A config's `name` stays in the consumer |
| `runTurn(input, options)`; `ChatTurnInput.provider` (the consumer's name), `.model` | `streamSimple(model, context, options)`, `completeSimple(...)`; `ChatModelRef.provider` (the pi-ai id), `.id` |
| `.systemPrompt`, `.history`, `.message`, `ChatHistoryMessage`; `.documents` (required), `.responseSchema` | `Context.systemPrompt`, `Context.messages`; the `documents` option (optional); `responseSchema` with a `ChatToolFreeContext` |
| `ChatTurnSettings { temperature, maxOutputTokens, reasoning }`, `ChatTurnOptions { signal }` | Options `temperature`, `maxTokens`, `reasoning` and `signal`. New: `toolChoice`, `sessionId`, `maxRetries` |
| Events `text`, `done { usage?, truncated? }`, `failed` | pi-ai's events; `truncated` becomes `stopReason: "length"` |
| `ChatTurnError { code, provider, model, message, reason?, status? }`; `ABORTED` | `chatKit.error { code, status? }` and the message's own fields; `stopReason: "aborted"` |
| `usage`: `inputTokens` (cache included), `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens` | `chatKit.usage`: `input` (cache excluded), `output`, `cacheRead`, `cacheWrite`, `reasoning` |
| `ChatModelInfo` (`maxOutputTokens`; `input` with `file`), `ChatModelInput`; `ChatProviderModels.provider` (the consumer's name), `.kind` | `ChatModel`: pi-ai's `Model` plus `chatKit`; `provider` (the pi-ai id) |

Unchanged: `ChatDocument`, `ChatResponseSchema`, the rate types, and `totalTokens`, `costUsd`, `costSource` and `raw`. The portal writes its own migration sketch when it adopts 0.3.0 under DATA-4583. The image kit is unaffected: it imports only the provider packages' main entries.

### 7. The planned uses

- **Router.** It parses its own `model` string into a reference, and error codes map to HTTP statuses before any byte is sent. Still missing: tools together with structured output (OpenAI and Anthropic allow both); forced and named `toolChoice`; sampling parameters (pi-ai applies `samplingParams` only on OpenAI-compatible APIs); images by URL and files inside a message; `json_object` mode; client-set `cache_control`; `deferred` batches; the excluded models.
- **BYOK service.** Still missing: idle-kit eviction (the service's own job), a generic reseller factory, and a key check at registration.
- **Agent platform.** Tools and MCP tools pass through as pi-ai `Tool`s. pi-agent-core's `StreamFn` returns an `AssistantMessageEventStream` or a Promise of one, so a short adapter fits. Still missing: an exported adapter, documents placed after the first user message, and `deferred` runs.

Each gap can close without breaking callers, as a new optional option, a widened union, a loosened check, a new export or a new optional trait. Two exceptions: a new overload or required member breaks an implementer of `ChatKit`, such as a test fake or a proxy; and pi-ai's types are part of the public contract, pinned exactly, so a breaking pi-ai release is a breaking chat kit release.

### 8. Versioning

chat-kit 0.3.0 is the breaking release. It peers on `@earendil-works/pi-ai` `1.2.0` exactly, and on the provider packages optionally: google `>=0.6.0`, openrouter `>=0.1.0`, kie and toapis `>=0.5.0`, all `<1.0.0`. A package manager warns about an older provider package, and the chat kit's `TypeError` at registration stops it. google 0.6.0, kie 0.5.0 and toapis 0.5.0 are additive. openrouter 0.1.0 is new, released from `openrouter-vX.Y.Z`, with pi-ai as a required exact peer and only a `/pi-ai` entry, an exception recorded in the ADR 0002 and ADR 0004 amendments.

Amended 2026-10-22 ([DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583)), while implementing:

- `ChatProviderTraits` gains an optional `fetch`, the factory's `fetch` option. A turn goes through it unless the kit has its own; Google's chat provider sets none, because pi-ai's Gemini adapter rejects a custom fetch.
- A forced response-schema tool call is turned into text as follows. The call's `toolcall_*` events become `text_*` events and the call becomes one text block; free text the model wrote beside the call is dropped, so every `contentIndex` and partial message matches the final message; a call with no argument text (a real one sends an empty `partial_json`) streams its arguments, `{}`, as a `text_delta` before its `text_end`. A call that failed or was aborted before any argument text keeps its arguments as the text block. Two forced calls give two text blocks.
- A failure or abort after the model resolved carries the model's `api` on the message; `"unknown"` is for a reference that did not resolve, and for input rejected before it was looked up.
- The Google chat provider's streams always end with a result: a stream that ends without a final event, or throws, gets the result it completed with, else an `error` message (`aborted` when the request's signal was aborted) that keeps the content streamed so far. pi-ai's `lazyStream` awaits `result()`, so the wrapper must not leave it pending.
- `listModels()` returns copies of the models, so changing one reaches neither the next listing nor another kit.

Amended 2026-10-23 ([DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583)), before release:

- A turn on the OpenAI Completions or Responses API sends `OpenAI-Organization` and `OpenAI-Project` as `null`, which drops the headers the OpenAI SDK would add from `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID`: ADR 0003 has the packages read no environment variables, and the SDKs underneath should not add ambient configuration either. The SDKs' other environment settings are not suppressed: pi-ai creates the clients, and pinning the key's header against `OPENAI_CUSTOM_HEADERS` or `ANTHROPIC_CUSTOM_HEADERS` (which can replace it) would need the kit to pass the key. The README lists what still takes effect.
- A context that carries tool calls or tool results counts as using tools. A provider that takes none, or a model that does not, refuses it with `UNSUPPORTED`, even when the context declares no tools.
- The kit adds its document cache breakpoint on Anthropic Messages only while the request has fewer than Anthropic's four.
- A Google model reports `tools` for `gemini-*` and `gemma-4-*` ids, and `fileInput` (PDFs) for a `gemini-*` model that also reads images. The sources: Google's [Gemma on the Gemini API](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) page documents function calling and image input for `gemma-4-31b-it` and `gemma-4-26b-a4b-it` (it carries a banner that the documentation is deprecated in favour of gemma.ai), and its [document processing](https://ai.google.dev/gemini-api/docs/document-processing) page names Gemini models only and does not mention Gemma. So PDF input is off for Gemma, and every id neither page covers takes neither tools nor PDFs until Google documents it. `gemma-4-` is read as the Gemma 4 family: a later `gemma-4-…` id gets tools without a release, and the provider refuses a turn it cannot take.
- Checked live on 2026-10-23, through the kit with a real key, each case run once: `gemma-4-26b-a4b-it` and `gemma-4-31b-it` applied a response schema (an `enum` forced an answer no prompt would give, and a required field the prompt never mentioned was filled), and `gemma-4-26b-a4b-it` called a tool (`gemma-4-31b-it` was not run for tools). Google's Gemma page does not mention structured output, and its [structured output](https://ai.google.dev/gemini-api/docs/structured-output) page names Gemini models only, so this check is the only evidence for Gemma 4 there. The kit gates `responseSchema` by model nowhere on Google: it is on for every Google id, and nothing covers Gemma 3 or other families. The outputs are in a DATA-4583 comment, and the check should move into DATA-4580's key-gated smoke script.

Amended 2026-10-26 ([DATA-4583](https://hk01-digital.atlassian.net/browse/DATA-4583)), before release:

- A response schema over a conversation that holds tool calls or tool results is sent, not refused. Decision 12 (declared tools and a response schema are mutually exclusive) covers declared tools only: `context.tools`, or a system message's `toolsAdded`. A rule that went further and refused a schema over tool history was added on 2026-10-23 and removed before release, because it guarded against no documented provider error: Anthropic's [release notes](https://platform.claude.com/docs/en/release-notes/overview#february-27th-2025) of 2025-02-27 say that you are no longer required to provide any `tools` when a request includes `tool_use` and `tool_result` blocks, and the OpenAI and Gemini documentation say nothing about it. It has not been tried live on OpenAI or Gemini. Two requests differ from that picture. pi-ai's OpenAI Completions adapter adds an empty `tools` array when the history holds tool calls or results and no tools are declared, with the comment that Anthropic behind LiteLLM or a proxy requires the parameter. On Anthropic Messages without native structured output the schema is a forced tool call named after it, so the request declares one tool while the history's `tool_use` blocks carry other names; that has not been tried live either. A provider that rejects such a request ends the turn `PROVIDER_ERROR`. A provider that takes no tools still refuses tool calls and tool results in the conversation (`UNSUPPORTED`), as it refuses declared tools.
- The kit checks the fields it reads itself, before it reads them: a message has a known `role`; a user or system message's `content` is a string or an array of blocks, an assistant message's and a tool result's `content` is an array of blocks; every block is an object with a string `type`; a system message's `toolsAdded` and `toolsRemoved` are, when present, arrays of objects with a `name` (`null` counts as absent, as it does for pi-ai); and a response schema, a tool's `parameters` and an added tool's `parameters` serialise as JSON (no cycle, no `BigInt`). A context that fails is `INVALID_REQUEST`, whatever the model, so a malformed message neither throws nor hides `UNKNOWN_MODEL`. The message lists the first ten invalid fields of the reference, context and options together, each cut at 200 characters, and counts the rest. An input the kit cannot read when it validates it (a getter or proxy that throws) is invalid too. One that passes and then fails or changes on a later read ends the turn as an error whose code is not part of the contract, and what pi-ai itself reads is pi-ai's: a value with no text, thrown inside pi-ai, is not handled. The rest of a message is pi-ai's to read, so a message it cannot read (an assistant message without `usage`, a text block without `text`) ends the turn `PROVIDER_ERROR`.
- A `null` or missing `content` is invalid, though pi-ai's `transformMessages` would read it as empty. On the installed pi-ai 1.2.0 the token estimate that runs first on the context as given (`estimateContextTokens`, called from `simple-options`) throws on it, unless a later assistant message with a non-zero usage anchors the estimate: the estimate skips what comes before that message, and what the adapters then do with the empty content depends on the role and the provider path. A message the kit returned has a zero-filled `usage`, which anchors nothing, so a history of such messages always throws. The kit rejects it everywhere, so that the answer does not depend on where the message sits. A string among the blocks of a user message is invalid too: pi-ai's OpenAI Completions adapter would send it as an image part with no data (`data:undefined;base64,undefined`), and its estimate counts it as an image.
- Wording was changed in place on 2026-10-26, before release: decision 12 and the `INVALID_REQUEST` row of the error table now say "declared tools", and the two Google bullets of the 2026-10-23 amendment above were reworded to what Google's pages say, after reading them again. The live check those bullets record was made on 2026-10-23, and its outputs are in [a DATA-4583 comment](https://hk01-digital.atlassian.net/browse/DATA-4583?focusedCommentId=150806).

## Considered options

- **Keep 0.2.0's types, and map them to pi-ai in each consumer.** Rejected: every planned use would write the same mapping.
- **A separate `result()` shape, a `ChatModelInfo` projection, or extras inside an extended `Context`.** Rejected: they replace or fork pi-ai's types instead of reusing them; pi-agent-core could not take the stream, and a router could not pass the `Context` through untouched.
- **Keys per call, consumer-chosen provider names, or a string model reference.** Rejected: a chat provider binds its key, naming is the consumer's concern, and a string needs a parsing rule, since OpenRouter ids contain `/`.
- **Traits inside the chat kit, looked up by `Provider.id`.** Rejected: each new reseller would again need a chat kit release.

## Consequences

A new reseller needs a provider package release only, not a chat kit release. Consumers see thinking events and blocks, and decide whether to show them. History replay relies on pi-ai's adapters ignoring `chatKit` members; the chat kit's contract tests replay a message that has one.

Sources: pi-ai and pi-agent-core at `v1.2.0`: `packages/ai/src/` `types.ts`, `models.ts`, `providers/model-schema.ts`, `providers/openrouter.ts`, `utils/event-stream.ts`, `api/lazy.ts`, `api/transform-messages.ts`, `api/anthropic-messages.ts`, `api/google-shared.ts` and `api/openai-completions.ts`; `packages/ai/scripts/openrouter-catalog.ts`; `packages/agent/src/types.ts`.
