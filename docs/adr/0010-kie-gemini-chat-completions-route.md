# ADR 0010: Serve KIE's Gemini chat models through the Chat Completions route, not the Gemini-native route

- Status: Accepted
- Date: 2026-11-03
- Related: [DATA-4630](https://hk01-digital.atlassian.net/browse/DATA-4630), [ADR 0003](0003-explicit-provider-execution.md), [ADR 0005](0005-provider-reported-usage.md), [ADR 0008](0008-chat-kit-package.md), [ADR 0009](0009-chat-kit-contract-aligned-with-pi-ai.md)

## Context

opengraph2 analyses its template and source images with Gemini 3.8 Flash. Google's own key for that model is limited to Tier 2 and answers 429, so the app needs the same model from another provider. KIE sells it, and sells Gemini 3.6 Flash and Gemini 4 Argon.

kie 0.6.0 serves chat on two routes: Codex on OpenAI Responses and Claude on Anthropic Messages. KIE offers each Gemini chat model on two more routes, with the model named in the URL path:

| Route | URL | Image input |
| --- | --- | --- |
| Gemini-native | `POST /gemini/v1/models/<id>:streamGenerateContent` | base64 `inline_data` |
| Chat Completions | `POST /<id>-openai/v1/chat/completions` | `image_url`; the documentation shows only https URLs |

Live checks on 2026-11-03 (pi-ai 1.2.0, KIE key, one tiny turn per case, a 111 KB JPEG): both routes answered an image turn with the image as base64 on `gemini-3-8-flash`; the Chat Completions route did so on `gemini-3-6-flash` and `gemini-4-argon` too.

Through pi-ai's own adapters, the two routes behave differently.

- **Gemini-native, with pi-ai's Gemini adapter.** The adapter accepts a model `baseUrl` and an `Authorization` header, so the request is made and text and usage stream back. Every turn then ends with `stopReason: "error"` and `Unexpected token 'D', "[DONE]" is not valid JSON`: KIE closes its stream with `data: [DONE]`, and the Gemini SDK parses it as JSON. Seen on `gemini-3-8-flash` (with and without Gemini safety settings) and on `gemini-4-argon`, which had also failed earlier outside this repo with the Gemini SDK. The SDK drops `credits_consumed`, KIE's own charge and the basis of a KIE turn's cost (ADR 0009); the chunks it hands over have only `candidates`, `usageMetadata` and `sdkHttpResponse`. A wrong key or an unknown model is answered with HTTP 200 and a `{ "code", "msg" }` body, which the SDK reports as `Incomplete JSON segment at the end`, so KIE's message is lost. The adapter throws `Custom fetch is not supported by the Google Generative AI adapter` for any fetch but the global one, so the package cannot wrap the request as it does on the other routes.
- **Chat Completions, with pi-ai's `openai-completions` adapter.** The stream carries the text, the usage and `credits_consumed` (0.12 for the 3.8 Flash image turn), and the adapter hands the raw chunk to `onProviderStreamEvent`. The turn ends with `Stream ended without finish_reason`, because KIE sends none. Errors are the same HTTP 200 `{ "code", "msg" }` bodies (`401 Unauthorized`, `422 The model is not supported`), seen by the adapter as an empty stream. This adapter accepts a custom fetch.

## Decision

kie serves `gemini-3-8-flash`, `gemini-3-6-flash` and `gemini-4-argon` on the Chat Completions route. A model's id in the package is the id KIE shows in its playground (`gemini-3-8-flash`); the route path adds `-openai`.

- The internal chat provider gets an `openai-completions` protocol beside `openai-responses` and `anthropic-messages`, and a model definition may carry its own base URL, because this route names the model in the path (`https://api.kie.ai/gemini-3-8-flash-openai/v1`).
- The route's errors go through the existing `kieEnvelopeFetch`, which already turns KIE's HTTP 200 envelope into a real HTTP error carrying KIE's code and message.
- KIE's two model lists (Codex and Claude) name no Gemini model, and no other list does: its public pricing listing carries no model ids and no documentation. The three models are therefore offered from the package's definitions, and a model KIE withdraws fails with KIE's own message.
- A new fetch wrapper adds the missing `finish_reason` (`stop`) after the usage chunk, before `[DONE]`, to a stream that carried content and none, so a successful turn ends as a normal stop.
- A turn's cost stays KIE's `credits_consumed` × `KIE_USD_PER_CREDIT`, never an estimate and never derived from token counts.

## Considered options

- **Gemini-native through pi-ai's Gemini adapter.** Rejected. A turn cannot succeed, the charge and KIE's error messages are lost, and the package has no way to wrap the request. Swallowing the `[DONE]` failure by matching its message would leave the other two problems and break with the next SDK release.
- **Gemini-native through a stream implementation of our own.** Rejected for now. It would reimplement what pi-ai's Gemini adapter does (message conversion, thinking, tool calls, events) for the sake of one provider, when the Chat Completions route reaches the same models. The native route documents `inline_data`, `file_data` and `thinkingConfig` more fully, which is its one advantage.
- **Not offering KIE's Gemini models.** Rejected. A consumer application that tuned its prompts on Gemini 3.8 Flash would lose the same model, and with Google's key limited to Tier 2 it could not run that analysis at all.

## Consequences

The three models are the Gemini models, reached through KIE's OpenAI-compatible layer, so that layer's behaviour is KIE's. Two effects were seen: Gemini 4 Argon replies carry `[cite: n]` markers, and on Gemini 3.8 Flash `total_tokens` exceeded the prompt and completion tokens by about 465, probably thinking tokens KIE does not itemise. A consumer that feeds a reply into another model must tolerate the markers. The package keeps the token counts as reported, but they are not a basis for cost.

KIE prices the three models at limited-time discounts with announced end dates. For 3.8 and 3.6 Flash KIE states the discount ("50% OFF"), so the regular price is published, and their rates are dated schedules: the discount, then the regular price. For 4 Argon KIE says only that its price "follows Google's promotional pricing" until 2026-11-30, and publishes no later price; a rate is published provider data (the glossary's Model rate), so Argon's schedule stays one period until KIE publishes the next, and a patch release adds it.

A response schema goes as a strict `response_format`. KIE takes its shape but does not enforce it: in a live check on 2026-11-03, Gemini 3.8 Flash and 4 Argon answered JSON with the schema's keys (its `colors`, though the prompt said "colours") and a `mood` outside the schema's `enum`. The chat kit does not validate an answer on any provider, so a consumer that relies on a schema validates the answer itself.

Gemini-native request settings (safety settings, the grounding tools, `thinkingConfig`) are not sent on this route. It offers `reasoning_effort` (`low` or `high`) and `include_thoughts`. A turn's `reasoning` goes as `reasoning_effort`: the definitions mark `low` and `high` as the only levels, so pi-ai sends the nearest of them (`minimal` and an explicit `off` as `low`; `medium`, `xhigh` and `max` as `high`), and none when the turn sets no level, leaving KIE's default. `include_thoughts` is never sent.

KIE reports no reason for a reply cut off at the token limit, so such a turn ends `stop` too. The usage record's `output` against the limit is the only sign; thinking tokens are not in KIE's completion count, so even that can miss.

The change is confined to the kie package and the internal chat provider. The chat kit selects its wire from the model's API and already has one for OpenAI Completions, and a live turn through the chat kit 0.4.1 on all three models, each with a base64 JPEG, succeeded (2026-11-03), with the cost from `credits_consumed`, `reasoning` of `low` and `medium`, and KIE's own message for a rejected key. One coupling remains: that wire was written for OpenRouter, the only provider on this API until now, and adds OpenRouter's file-parser `plugins` parameter to every request. KIE ignores it. If KIE ever rejects unknown parameters, gating it on `targetsOpenRouter` in the chat kit is the fix. kie 0.7.0 is additive, and the chat kit's peer range for kie (`>=0.5.0 <1.0.0`) already admits it.

Revisit the decision if pi-ai's Gemini adapter accepts a custom fetch, or if the Gemini SDK tolerates `data: [DONE]`: the native route would then work through the shared adapter.
