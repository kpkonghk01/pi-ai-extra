# ADR 0005: Report provider usage as reported, reconcile billing by task id

- Status: Accepted
- Date: 2026-09-28
- Related: [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513)

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
- The pi-ai image adapter fills `AssistantImages.usage` only when token counts exist, following pi-ai's own conventions. Chat model cost stays `0` by default; consumers set `ChatModelDefinition.cost` from their provider's prices.

Amended 2026-10-16 ([DATA-4566](https://hk01-digital.atlassian.net/browse/DATA-4566)): the KIE and ToAPIs default chat model lists now carry each provider's published per-token rates, with the date and source next to them, so pi-ai computes chat `usage.cost`. That cost is pi-ai's calculation from token counts, not a provider-reported charge, and it changes only with a package release. Where a provider publishes no cache rate, the cache rates equal the input rate as an upper bound; a model with no published price keeps `0` until a rate format can express "no rate" ([DATA-4568](https://hk01-digital.atlassian.net/browse/DATA-4568)). Consumers can still replace `cost`.

## Consequences

Recorded spend matches what each provider settles, including refunds. Consumers must handle provider-specific units (KIE credits as numbers, ToAPIs credits/USD as decimal strings) and re-query pending ToAPIs billing later.
