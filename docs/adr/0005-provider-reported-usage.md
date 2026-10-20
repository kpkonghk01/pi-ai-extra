# ADR 0005: Report provider usage as reported, reconcile billing by task id

- Status: Accepted
- Date: 2026-09-28
- Related: [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513), [DATA-4566](https://hk01-digital.atlassian.net/browse/DATA-4566), [DATA-4568](https://hk01-digital.atlassian.net/browse/DATA-4568)

## Context

A proxy service will record per-app spend by provider. Providers report usage differently:

- **KIE**: `recordInfo` reports `creditsConsumed` and `costTime`.
- **ToAPIs**: reports `billing` (status plus decimal-string amounts) and token `usage`. Its `billing.status` may still be `pending` when a task is `completed`.
- **Gemini**: `generateContent` returns `usageMetadata` token counts. The JSON API omits zero-valued counters.

## Decision

- `ImageGenerationResult.usage` holds only provider-reported, Zod-validated values. Nothing is estimated, and missing fields are omitted, not set to `0`.
- ToAPIs amounts stay decimal strings. KIE `costTime` is treated as milliseconds, as the Get Task Details reference states (the callback schema says seconds).
- A usage block with an unexpected shape is omitted, with a `warning` progress event. A finished, billed image is never discarded because of accounting metadata.
- `getKieTask()` and `getToapisTask()` re-read a task by id. Consumers keep one usage record per task id and replace it with newer lookups; they never sum values observed while polling.
- ToAPIs requests may carry a validated `clientBusinessId`, sent as top-level `client_business_id`, for attribution.
- The pi-ai image adapter fills `AssistantImages.usage` only when token counts exist, following pi-ai's own conventions. Chat model cost stays `0` by default (narrowed on 2026-10-16 to consumer-supplied definitions; see the amendments below); consumers set `ChatModelDefinition.cost` from their provider's prices.

Amended 2026-10-16 ([DATA-4566](https://hk01-digital.atlassian.net/browse/DATA-4566)): the last point's chat rule, "chat model cost stays `0` by default", no longer holds. [ADR 0008](0008-chat-kit-package.md) replaces it, and the glossary's [Model rate](../../CONTEXT.md#model-rate) defines the term: a model whose rate is not published has no rate, never a zero rate.

- Published rates now ship in the package definitions. The KIE and ToAPIs default chat model lists carry each provider's published per-token rates, dated and sourced, so pi-ai computes chat `usage.cost`. That cost is pi-ai's calculation from token counts, not a provider-reported charge, and it changes only with a package release. Consumers can still replace `cost`.
- The default lists offer no model without a published rate. ToAPIs `gpt-5.3-codex` and `gpt-5.3-codex-spark` were removed for this reason; a consumer can still pass them in `models`.
- Interim until [DATA-4568](https://hk01-digital.atlassian.net/browse/DATA-4568), which settles model rates:
  - A cache rate the provider does not publish is filled in. Cache reads are charged at the input rate, an upper bound. Cache writes are charged at 1.25 × input, the price of a 5-minute write on Anthropic and in KIE's own Codex rows; a 1-hour write costs 2 × input on Anthropic.
  - A consumer-supplied definition without `cost` still gets zero rates, because pi-ai's `Model.cost` cannot be absent.

Amended 2026-10-16 ([DATA-4568](https://hk01-digital.atlassian.net/browse/DATA-4568)): the DATA-4566 amendment says the chat rule "no longer holds", yet its own second interim rule keeps zero rates for a consumer-supplied definition without `cost`. The rule is narrowed, not replaced: it no longer holds for the package default lists, which carry published rates and offer no model without one, and it still holds for consumer-supplied definitions. [ADR 0008](0008-chat-kit-package.md)'s matching point is amended the same way. Both interim rules still apply until DATA-4568's dated model rates settle them.

## Consequences

Recorded spend matches what each provider settles, including refunds. Consumers must handle provider-specific units (KIE credits as numbers, ToAPIs credits/USD as decimal strings) and re-query pending ToAPIs billing later.
