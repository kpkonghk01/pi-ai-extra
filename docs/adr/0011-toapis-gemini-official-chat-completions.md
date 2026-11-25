# ADR 0011: Offer ToAPIs' Gemini as its `-official` ids, on the Chat Completions route

- Status: Accepted
- Date: 2026-11-25
- Related: [ADR 0009](0009-chat-kit-contract-aligned-with-pi-ai.md), [ADR 0010](0010-kie-gemini-chat-completions-route.md)

## Context

A consumer wants Gemini 4 with a response schema and Knowledge files. Google's own key cannot use Gemini 4 yet, and KIE's Gemini route refuses the consumer's article-scan schema: KIE's validator mistakes a property named `type` for the keyword.

ToAPIs sells Gemini 3.8 Flash and Gemini 4 Argon, Carbon and Hydrogen, each under two ids. One is plain (`gemini-4-argon`), at 20% of Google's reference price. The other ends in `-official` (`gemini-4-argon-official`), at 60–80%. ToAPIs serves both on two routes: OpenAI Chat Completions, which it documents, and a Gemini-native route at `/v1beta/models/<id>:streamGenerateContent` with `x-goog-api-key`, which it does not document. It lists them in `GET /v1/models?type=text` only once the key has chat permission for them.

Live checks on 2026-11-25, with a key allowed all eight ids, one tiny turn per case on both routes:

- The `-official` ids:
  - They kept the system prompt and a response schema.
  - They read a PDF sent inline, and on the native route one sent by link.
  - They reported thought tokens and the real `modelVersion`.
  - One inline PDF on 3.8 Flash got a 403 "生成服務暫時無法使用" and passed on retry.
- The plain ids did not:
  - `gemini-3.8-flash`, `gemini-4-argon` and `gemini-4-carbon` answered prose instead of the schema's JSON.
  - `gemini-4-hydrogen` ignored the system prompt, and its schema turn on Chat Completions hung for 120 s and came back empty.
  - `gemini-4-carbon` failed an inline PDF (404).
  - `gemini-4-argon` and `gemini-4-carbon` said no PDF was attached when one was sent by link.

## Decision

The toapis package offers `gemini-3.8-flash-official`, `gemini-4-argon-official`, `gemini-4-carbon-official` and `gemini-4-hydrogen-official` on Chat Completions (`<host>/v1`). They use pi-ai's OpenAI Completions adapter, as KIE's Gemini models do (ADR 0010).

- **Rates** are ToAPIs' published ratios: input = 2 × `model_ratio`, output = input × `completion_ratio`, and a cache read = input × `cache_ratio` where ToAPIs lists one. ToAPIs reports no charge, so a turn's cost is estimated.
- **Instructions** go as a `system` message (`compat.supportsDeveloperRole: false`). pi-ai sends a reasoning model's instructions as `developer` to a standard OpenAI host, and ToAPIs failed every such Gemini request: 400 "生成失敗: 工作處理失敗", or 403 on 3.8 Flash. The same body with `system` answered.
- **Reasoning:** `reasoning_effort` is `low`, `medium` or `high`. ToAPIs took every value tried, from `minimal` to `xhigh` and `none`, and the thought counts did not tell them apart, so the definitions mark only the levels Gemini 3.8 Flash and 4 share.
- **Response schema:** the chat kit (0.5.1) sends a Gemini model on Chat Completions the schema reduced as on Gemini's own API (`sanitizeSchemaForGemini`). ToAPIs failed the article-scan schema, which has `minItems` and `maxItems`, until it was reduced.
- **Documents** stay off for ToAPIs (`takes.fileDocuments: false`). It is a provider-wide trait, and ToAPIs' Codex and Claude are still unchecked.

## Considered options

- **The plain ids.** Rejected. They are a quarter of the price, but they dropped what a Gem depends on: the system prompt and the schema. A consumer that wants them passes them in the factory's `models` option.
- **The Gemini-native route through pi-ai's Gemini adapter.** Not now.
  - What it would add: it read PDFs by link, and it would take `thinkingConfig` directly.
  - Why not now: Chat Completions reaches the same models through infrastructure the packages already run for KIE, and ToAPIs does not document the native route.
  - Revisit when a consumer needs Knowledge files by link on ToAPIs.

## Consequences

The article-scan turn as a consumer sends it (a 1,600-character Chinese system prompt, a 2,600-character article as JSON, the 5.6 KB schema) answered on all four ids on 2026-11-25, 2 of 2 each:

| Model | Time | Answer against the consumer's Zod schema |
|---|---|---|
| `gemini-3.8-flash-official` | about 60 s | valid both times |
| `gemini-4-hydrogen-official` | 60–70 s | one array over its exact length both times |
| `gemini-4-argon-official` | about 100 s | headlines over the 30-character `maxLength` |
| `gemini-4-carbon-official` | about 100–160 s | headlines over the 30-character `maxLength`; one array over its exact length |

Gemini follows a schema's shape but not every constraint, and the reduced schema has no `minItems` or `maxItems` to follow, so a consumer validates the answer.

A key without chat permission for an id gets 403 "沒有執行此請求的權限". The live list leaves such ids out.

Amended 2026-11-25, for pi-ai 1.6.0 (toapis 0.9.0): pi-ai 1.6 sends a reasoning model's instructions on OpenAI Completions as `system` to every host but `api.openai.com`, so the definitions no longer set `compat.supportsDeveloperRole: false`, and `ChatModelDefinition` loses the `compat` field it was added for. A test still checks that ToAPIs' Gemini gets `system`.
