# ADR 0003: Require explicit server-side keys and forbid fallback

- Status: Accepted
- Date: 2026-09-25
- Related: [DATA-4512](https://hk01-digital.atlassian.net/browse/DATA-4512), [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513)

## Context

Consumer applications choose a provider and model for cost, model behaviour, availability, and operational ownership. Existing per-app implementations can switch models or use another provider's file storage after a failure.

That behaviour hides the actual failing provider/model and makes it difficult for an operator to know which provider console, key, quota, or task record to inspect. It also crosses credential and data-storage boundaries without the caller selecting them.

## Decision

Consumer applications supply provider keys explicitly from server-side secret configuration. Adapter packages do not read environment variables, store credentials, or provide browser entrypoints.

A request is executed only by its selected provider/model. The adapter may retry a transient operation with the same provider/model, but it must not:

- change provider;
- change model;
- upload a reference image to another provider's storage; or
- silently discard reference images that exceed a model limit.

Failures include the selected provider and model in their error context.

## Consequences

Users see a direct failure rather than an apparently successful result from an unselected service. Operations and billing remain attributable to the selected provider.

Consumers must display and handle provider-specific errors. They can offer another provider/model in their UI, but the user or application must make that new request explicitly.
