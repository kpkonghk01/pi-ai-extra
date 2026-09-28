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

## Consequences

Recorded spend matches what each provider settles, including refunds. Consumers must handle provider-specific units (KIE credits as numbers, ToAPIs credits/USD as decimal strings) and re-query pending ToAPIs billing later.
