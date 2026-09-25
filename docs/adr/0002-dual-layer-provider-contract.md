# ADR 0002: Expose pi-ai factories and validated image helpers

- Status: Accepted
- Date: 2026-09-25
- Related: [DATA-4513](https://hk01-digital.atlassian.net/browse/DATA-4513)

## Context

`@earendil-works/pi-ai` provides a common provider and image-generation surface. Its public image options intentionally contain generic metadata, while KIE and ToAPIs image model operations have incompatible fields, input-image handling, asynchronous task lifecycles, and output formats.

Using only pi-ai would leave consumer applications to pass unvalidated provider-specific metadata and reimplement upload/poll/result handling. Exposing only custom helpers would prevent applications that already own a pi-ai `Models` collection from registering adapters normally.

## Decision

Each public adapter package exposes two complementary layers:

1. A pi-ai provider factory (`createKieProvider()` or `createToapisProvider()`) for standard protocol integration and existing `Models` collections.
2. A Zod-validated high-level image helper (`generateKieImage()` or `generateToapisImage()`) for model operation schemas, provider-native reference-image upload, task polling, and normalized output.

When a capability cannot accurately fit the common image helper, the adapter exposes an additional explicit operation rather than adding untyped escape-hatch fields.

## Consequences

Consumer applications do not need to duplicate provider wiring. They select the appropriate layer based on their existing application boundary.

Provider-specific image parameters remain discoverable and validated. The public contract grows through named operations rather than a universal proxy with ambiguous model switches.
