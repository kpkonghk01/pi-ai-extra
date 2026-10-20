# ADR 0008: Ship a server-side chat kit that runs a turn the same way on every provider

- Status: Accepted
- Date: 2026-10-16
- Related: data-gen-ai-portal ADR 0010 (provider layer on pi-ai and Chat kit), [DATA-4568](https://hk01-digital.atlassian.net/browse/DATA-4568)

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

Amended 2026-10-16 ([DATA-4568](https://hk01-digital.atlassian.net/browse/DATA-4568)), where building the lists, rates and cost changed the decision:

- **Model rates.** Until the dated rates shipped, the point "chat model cost no longer defaults to `0`" held for the package default lists only: a consumer-supplied definition without `cost` still got zero rates, an interim recorded in [ADR 0005](0005-provider-reported-usage.md)'s DATA-4566 and DATA-4568 amendments. With `ChatModelDefinition.rate` it holds for every definition: one without a rate has no rate, and the kit reports no cost for it.
- **Live model lists.** KIE lists in two places: Codex at `/openai/v1/models` and Claude at `/anthropic/v1/models`. ToAPIs lists text models at `/v1/models?type=text`. Until a live list has been read, a turn or listing reads it and waits for it. A live list is fresh for 30 minutes; after that a turn or listing answers from it at once and reads it again in the background (stale-while-revalidate), so no turn waits for a refresh. The trade-off is accepted: a model the provider has dropped may be sent once more after the 30 minutes, until that refresh lands, and the provider then answers with its own error. A list read has one deadline for all its requests and pages (KIE's two lists, Gemini's pages): 5 seconds for the read turns wait on, and, by product-owner decision, 15 seconds for a background refresh, which no turn waits on. A failed refresh keeps the last good list, or uses the installed catalogue or definitions when none has been read, and is retried after a minute; concurrent callers share one refresh, and turns resolve against the same list. The installed catalogues are filtered by the live lists' rules. On OpenRouter, models without tool support are listed (the kit sends no tools), `:batch` models are not, nor `:free` ones (heavily rate-limited, and their providers may train on the prompts, which does not suit a newsroom gateway). The product owner decided two more exclusions, on every provider, for the live lists and the installed catalogues alike: no image-output model is offered, since Gems do not take image answers yet (offering them will be a separate decision); and no model whose provider picks the model itself is offered, since it can silently change behaviour and price: OpenRouter's own `openrouter/*` routers, third-party routers named by id (`typesafe/jev-router`, `nvidia/switchyard`), and every `-latest` moving alias, with or without OpenRouter's `~` prefix. pi-ai's OpenRouter chat catalogue has no output modalities, so an installed model that answers with images is found by its id in pi-ai's OpenRouter image catalogue. A new `anthropic/*` id runs on OpenAI Completions, so a new Claude family is never sent pi-ai's budget-thinking parameters. pi-ai's OpenRouter catalogue has no file input, so its models report no file input while OpenRouter's list cannot be read, and a PDF turn on them is `UNSUPPORTED`. Gemini keeps plain text chat models under their own ids only (no embedding, Imagen, Veo, TTS, Live, computer use, image-output, including Nano Banana, or Deep Research models, and no `-latest` alias), on its live list and on the installed catalogue alike.
- **Response schema.** Anthropic Messages has native structured output too (`output_config.format`), which works while the model thinks. The kit uses it for a turn that thinks, where the provider takes it: OpenRouter, which documents it, and KIE, which does not but answered valid JSON under it while thinking in a live smoke test (`claude-opus-5-5`, 2026-10-16). ToAPIs keeps the forced tool call, and a thinking turn with a schema stays `UNSUPPORTED` there until a live smoke test verifies native structured output.
- **Cost.** Each provider kind's cost rules, including why KIE's cost is never estimated, are stated once, in the README's [Usage and cost](../../README.md#usage-and-cost). OpenRouter's rates come from its live `/models` pricing, since no package holds them; until the live list is read, OpenRouter models are priced from pi-ai's catalogue.

## Considered options

- **Fill the gaps inside each provider package.** Rejected: it duplicates per-API code, and `google` and `openrouter` have no package to hold it.
- **Leave the gaps to consumers.** Rejected: every consumer would re-implement them, as the gateway does today.
- **Read rates live from the KIE and ToAPIs pricing endpoints.** Rejected: those endpoints are undocumented and can change silently.
- **Keep the Gemini Files API.** Rejected: it is Gemini-only, and its ids expire after 48 hours.

## Consequences

- The kit depends on the provider SDK request shapes that pi-ai hands to `onPayload`. pi-ai is pinned exactly, and each API has contract tests.
- Chat model rates are now package data. An image cost estimate stays app-owned. A price change needs a release; changes announced ahead of time are published in advance with their effective date.
- Document support for each reseller model starts disabled. It is enabled after a live smoke test, because KIE and ToAPIs do not document it.
