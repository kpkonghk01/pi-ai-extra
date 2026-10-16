# ADR 0008: Ship a server-side chat kit that runs a turn the same way on every provider

- Status: Accepted
- Date: 2026-10-16
- Related: data-gen-ai-portal ADR 0010 (provider layer on pi-ai and Chat kit)

## Context

The data-gen-ai-portal gateway wants to add cheaper reseller providers by upgrading packages and editing config, with no per-provider code in the gateway.

pi-ai 1.2 covers streaming, explicit keys and the built-in `google` and `openrouter` providers. Several things a gateway needs are missing:

- There is no document input. Only base64 images are supported.
- There is no response-schema option.
- A safety block is not a distinct stop reason, and a Gemini prompt-level block is not reported at all.
- A provider's reported cost is never read.
- Gemini grounding cannot be toggled.
- Models are listed only from a catalogue frozen at release.

These gaps belong to each wire API (Gemini, OpenAI Completions, OpenAI Responses, Anthropic Messages), not to each provider. The built-in providers have no pi-ai-extra package that could hold a fix. An upstream pi-ai change is not being pursued.

## Decision

Add `@hk01/pi-ai-extra-chat-kit`. It is the chat counterpart of the image kit: server-only, with no browser or React entry.

**Providers and keys**

- It registers built-in and pi-ai-extra providers from secrets the consumer passes explicitly (ADR 0003).
- Each provider is registered under a provider name the consumer chooses. The name may differ from the library id, for example `gemini` → `google`.

**Turn input**

- The turn input is the kit's own type: system prompt, history, message, documents, response schema and generation settings.
- A document is `{ name, mimeType, url?, load() }`. Documents never enter pi-ai messages.
- For each API, an `onPayload` transform inserts the documents right after the system prompt. It sends each one as a link where the API documents link input, as inline bytes otherwise, or as text for plain-text files.
- That fixed position lets provider prompt caching reuse the documents.

**Per-API features**

- Response schema: native structured output where the API has it, otherwise a forced tool call on Anthropic Messages.
- Safety-block classification, including the Gemini prompt-level block.
- Capture of provider-reported cost: OpenRouter `usage.cost` and KIE `credits_consumed`.
- A Google grounding switch.
- Retries only before generation starts.

**Live model lists**

| Provider | Source |
|---|---|
| OpenRouter | `/models` |
| Gemini | `models.list` ids, with metadata from the pi-ai catalogue |
| KIE, ToAPIs | `/v1/models`, intersected with the package definitions |

**Model rates**

- Provider packages publish model rates with effective dates, large-prompt tiers and cached-input rates.
- When a provider reports no cost, the kit estimates one from the rate in force at call time.
- When no rate is published, it reports no cost.
- This amends the last point of ADR 0005: chat model cost no longer defaults to `0`.

**Unsupported requests**

- A model that cannot take a request's documents or schema fails explicitly. The kit never changes provider or model.
- On OpenRouter it always pins the `native` file parser, so a request never falls through to paid OCR.

**Prerequisites**

- Upgrade pi-ai from 0.87.1 to 1.2.x across the packages.
- Correct the KIE and ToAPIs chat definitions to the providers' current endpoints and model ids.

## Considered options

- **Fill the gaps inside each provider package.** Rejected: it duplicates per-API code, and `google` and `openrouter` have no package to hold it.
- **Leave the gaps to consumers.** Rejected: every consumer would re-implement them, as the gateway does today.
- **Read rates live from the KIE and ToAPIs pricing endpoints.** Rejected: those endpoints are undocumented and can change silently.
- **Keep the Gemini Files API.** Rejected: it is Gemini-only, and its ids expire after 48 hours.

## Consequences

- The kit depends on the provider SDK request shapes that pi-ai hands to `onPayload`. pi-ai is pinned exactly, and each API has contract tests.
- Chat model rates are now package data. An image cost estimate stays app-owned. A price change needs a release; changes announced ahead of time are published in advance with their effective date.
- Document support for each reseller model starts disabled. It is enabled after a live smoke test, because KIE and ToAPIs do not document it.
