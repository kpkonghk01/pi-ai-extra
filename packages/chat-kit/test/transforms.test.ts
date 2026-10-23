import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { TurnFailure } from "../src/errors.ts";
import type { PreparedDocument } from "../src/documents.ts";
import { isAlwaysThinkingClaude, transformAnthropicPayload } from "../src/wire/anthropic-messages.ts";
import { sanitizeSchemaForAnthropic } from "../src/wire/anthropic-schema.ts";
import { sanitizeSchemaForGemini } from "../src/wire/gemini-schema.ts";
import { placeGoogleDocument, transformGooglePayload } from "../src/wire/google.ts";
import { transformOpenAICompletionsPayload } from "../src/wire/openai-completions.ts";
import { transformOpenAIResponsesPayload } from "../src/wire/openai-responses.ts";
import { targetsOpenRouter } from "../src/wire/openrouter.ts";
import type { PayloadPlan } from "../src/wire/types.ts";

const MARKER = "[[chat-kit:documents:test]]";
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

const TEXT_DOC: PreparedDocument = { kind: "text", name: "notes.md", mimeType: "text/markdown", text: "# Notes" };
const PDF_BY_URL: PreparedDocument = {
  kind: "pdf",
  name: "brief.pdf",
  mimeType: "application/pdf",
  source: { type: "url", url: "https://cdn.example.com/brief.pdf" },
};
const PDF_INLINE: PreparedDocument = {
  kind: "pdf",
  name: "brief.pdf",
  mimeType: "application/pdf",
  source: { type: "base64", data: "JVBERg==" },
};
const PNG_BY_URL: PreparedDocument = {
  kind: "image",
  name: "logo.png",
  mimeType: "image/png",
  source: { type: "url", url: "https://cdn.example.com/logo.png" },
};
const PNG_INLINE: PreparedDocument = {
  kind: "image",
  name: "logo.png",
  mimeType: "image/png",
  source: { type: "base64", data: "iVBORw==" },
};
const TEXT_PART = '<document name="notes.md">\n# Notes\n</document>';

function plan(overrides: Partial<PayloadPlan> = {}): PayloadPlan {
  return {
    marker: MARKER,
    documents: [TEXT_DOC, PDF_BY_URL, PNG_INLINE],
    responseSchema: undefined,
    targetsOpenRouter: false,
    nativeStructuredOutput: false,
    ...overrides,
  };
}

function expectMarkerFailure(run: () => unknown, problem: RegExp): void {
  assert.throws(run, (error: unknown) => error instanceof TurnFailure && error.code === "UNSUPPORTED" && problem.test(error.message));
}

describe("Gemini payload transform", () => {
  const abortSignal = new AbortController().signal;
  const payload = () => ({
    model: "gemini-3.5-flash",
    contents: [
      { role: "user", parts: [{ text: MARKER }, { text: "Q1" }] },
      { role: "model", parts: [{ text: "A1" }] },
      { role: "user", parts: [{ text: "Q2" }] },
    ],
    config: { systemInstruction: "Be brief.", abortSignal, tools: [{ functionDeclarations: [] }] },
  });

  it("replaces the marker with fileData (URL), inlineData (bytes) and text parts, without mutating its input", () => {
    const input = payload();
    const snapshot = structuredClone({ ...input, config: { ...input.config, abortSignal: undefined } });
    const next = transformGooglePayload(input, plan({ documents: [TEXT_DOC, PDF_BY_URL, PDF_INLINE, PNG_INLINE] })) as ReturnType<
      typeof payload
    >;
    assert.deepEqual(next.contents[0]?.parts, [
      { text: TEXT_PART },
      { fileData: { fileUri: "https://cdn.example.com/brief.pdf", mimeType: "application/pdf" } },
      { inlineData: { mimeType: "application/pdf", data: "JVBERg==" } },
      { inlineData: { mimeType: "image/png", data: "iVBORw==" } },
      { text: "Q1" },
    ]);
    assert.deepEqual(next.contents.slice(1), input.contents.slice(1));
    assert.equal(next.config.abortSignal, abortSignal, "the SDK abort signal is kept");
    assert.deepEqual({ ...input, config: { ...input.config, abortSignal: undefined } }, snapshot);
  });

  it("adds the sanitized response schema, and leaves grounding to the Google provider", () => {
    const next = transformGooglePayload(
      payload(),
      plan({ marker: undefined, documents: [], responseSchema: { name: "x", schema: { ...SCHEMA, maxItems: 2 } } }),
    ) as {
      config: Record<string, unknown>;
    };
    assert.equal(next.config.responseMimeType, "application/json");
    assert.deepEqual(next.config.responseJsonSchema, SCHEMA);
    assert.deepEqual(next.config.tools, [{ functionDeclarations: [] }]);
    assert.equal(next.config.systemInstruction, "Be brief.");
  });

  it("leaves tools and schema alone when neither is requested", () => {
    const next = transformGooglePayload(payload(), plan({ marker: undefined, documents: [] })) as { config: Record<string, unknown> };
    assert.deepEqual(next.config.tools, [{ functionDeclarations: [] }]);
    assert.equal(next.config.responseJsonSchema, undefined);
  });

  it("fails when the marker is missing, repeated or merged into other text", () => {
    expectMarkerFailure(() => transformGooglePayload({ contents: [{ role: "user", parts: [{ text: "Q" }] }] }, plan()), /was not found/);
    expectMarkerFailure(
      () => transformGooglePayload({ contents: [{ role: "user", parts: [{ text: MARKER }, { text: MARKER }] }] }, plan()),
      /appeared 2 times/,
    );
    expectMarkerFailure(
      () => transformGooglePayload({ contents: [{ role: "user", parts: [{ text: `${MARKER}\nQ` }] }] }, plan()),
      /merged/,
    );
  });

  it("places a document by URL only when its size is known to be within 15 MB and the model is not Gemini 2.0", () => {
    const model = (id: string) => ({ id }) as Model<Api>;
    const doc = (size?: number) => ({
      name: "a.pdf",
      mimeType: "application/pdf",
      url: "https://x/a.pdf",
      ...(size === undefined ? {} : { size }),
      load: async () => new Uint8Array(),
    });
    assert.equal(placeGoogleDocument(doc(15_000_000), model("gemini-3.5-flash")), "url");
    assert.equal(placeGoogleDocument(doc(15_000_001), model("gemini-3.5-flash")), "inline");
    assert.equal(placeGoogleDocument(doc(), model("gemini-3.5-flash")), "inline");
    assert.equal(placeGoogleDocument(doc(10), model("gemini-2.0-flash")), "inline");
    assert.equal(placeGoogleDocument({ ...doc(10), url: undefined }, model("gemini-3.5-flash")), "inline");
  });
});

describe("sanitizeSchemaForGemini", () => {
  it("strips minItems/maxItems recursively but keeps property names that look like keywords", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        minItems: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 5 },
        nested: { type: "object", properties: { list: { type: "array", maxItems: 2 } }, additionalProperties: false },
      },
      $defs: { maxItems: { type: "integer", minimum: 0 } },
    };
    assert.deepEqual(sanitizeSchemaForGemini(schema), {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        minItems: { type: "array", items: { type: "string", minLength: 1 } },
        nested: { type: "object", properties: { list: { type: "array" } }, additionalProperties: false },
      },
      $defs: { maxItems: { type: "integer", minimum: 0 } },
    });
    assert.equal(sanitizeSchemaForGemini(schema), sanitizeSchemaForGemini(schema), "cached by identity");
    assert.equal(schema.properties.minItems.maxItems, 5, "the input is not mutated");
  });
});

describe("OpenAI Completions payload transform", () => {
  const payload = () => ({
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: "Be brief." },
      {
        role: "user",
        content: [
          { type: "text", text: MARKER },
          { type: "text", text: "Q1" },
        ],
      },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ],
    stream: true,
  });

  it("replaces the marker with file, image_url and text parts and pins the native file parser", () => {
    const input = payload();
    const snapshot = structuredClone(input);
    const next = transformOpenAICompletionsPayload(
      input,
      plan({ documents: [TEXT_DOC, PDF_BY_URL, PDF_INLINE, PNG_BY_URL, PNG_INLINE] }),
    ) as Record<string, unknown> & {
      messages: { content: unknown }[];
    };
    assert.deepEqual(next.messages[1]?.content, [
      { type: "text", text: TEXT_PART },
      { type: "file", file: { filename: "brief.pdf", file_data: "https://cdn.example.com/brief.pdf" } },
      { type: "file", file: { filename: "brief.pdf", file_data: "data:application/pdf;base64,JVBERg==" } },
      { type: "image_url", image_url: { url: "https://cdn.example.com/logo.png" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw==" } },
      { type: "text", text: "Q1" },
    ]);
    assert.deepEqual(next.plugins, [{ id: "file-parser", pdf: { engine: "native" } }]);
    assert.equal(next.response_format, undefined);
    assert.deepEqual(input, snapshot);
  });

  it("always pins the native file parser, replacing a caller's file-parser setting", () => {
    const next = transformOpenAICompletionsPayload(
      { ...payload(), plugins: [{ id: "web" }, { id: "file-parser", pdf: { engine: "mistral-ocr" } }] },
      plan({ marker: undefined, documents: [] }),
    ) as Record<string, unknown>;
    assert.deepEqual(next.plugins, [{ id: "web" }, { id: "file-parser", pdf: { engine: "native" } }]);
  });

  it("adds a strict response_format, leaving the routing preferences to the model's compat", () => {
    const next = transformOpenAICompletionsPayload(
      { ...payload(), provider: { order: ["openai"] } },
      plan({ marker: undefined, documents: [], responseSchema: { name: "answer", schema: SCHEMA } }),
    ) as Record<string, unknown>;
    assert.deepEqual(next.response_format, { type: "json_schema", json_schema: { name: "answer", schema: SCHEMA, strict: true } });
    assert.deepEqual(next.provider, { order: ["openai"] });
  });

  it("fails when the marker is missing or merged into a plain-text message", () => {
    expectMarkerFailure(
      () => transformOpenAICompletionsPayload({ messages: [{ role: "user", content: [{ type: "text", text: "Q" }] }] }, plan()),
      /was not found/,
    );
    expectMarkerFailure(
      () => transformOpenAICompletionsPayload({ messages: [{ role: "user", content: `${MARKER} Q` }] }, plan()),
      /plain-text message/,
    );
  });
});

describe("Anthropic Messages payload transform", () => {
  const cache = { type: "ephemeral" };
  const payload = () => ({
    model: "claude-sonnet-4-6",
    system: [{ type: "text", text: "Be brief.", cache_control: cache }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: MARKER },
          { type: "text", text: "Q1" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "Q2", cache_control: cache }] },
    ],
    max_tokens: 1000,
    thinking: { type: "disabled" },
    stream: true,
  });

  it("replaces the marker with document/image blocks and adds pi-ai's breakpoint to the last document block", () => {
    const input = payload();
    const snapshot = structuredClone(input);
    const next = transformAnthropicPayload(
      input,
      plan({ documents: [TEXT_DOC, PDF_BY_URL, PDF_INLINE, PNG_BY_URL, PNG_INLINE] }),
    ) as ReturnType<typeof payload>;
    assert.deepEqual(next.messages[0]?.content, [
      { type: "text", text: TEXT_PART },
      { type: "document", source: { type: "url", url: "https://cdn.example.com/brief.pdf" }, title: "brief.pdf" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERg==" }, title: "brief.pdf" },
      { type: "image", source: { type: "url", url: "https://cdn.example.com/logo.png" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw==" }, cache_control: cache },
      { type: "text", text: "Q1" },
    ]);
    assert.deepEqual(next.messages.slice(1), input.messages.slice(1));
    assert.deepEqual(input, snapshot);
  });

  it("keeps pi-ai's TTL and adds no breakpoint when caching is off", () => {
    const long = { type: "ephemeral", ttl: "1h" };
    const withTtl = { ...payload(), system: [{ type: "text", text: "S", cache_control: long }] };
    const cached = transformAnthropicPayload(withTtl, plan({ documents: [TEXT_DOC] })) as ReturnType<typeof payload>;
    assert.deepEqual(cached.messages[0]?.content[0], { type: "text", text: TEXT_PART, cache_control: long });
    const uncached = transformAnthropicPayload(
      {
        ...payload(),
        system: [{ type: "text", text: "S" }],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: MARKER },
              { type: "text", text: "Q" },
            ],
          },
        ],
      },
      plan({ documents: [TEXT_DOC] }),
    );
    assert.ok(!JSON.stringify(uncached).includes("cache_control"));
  });

  it("adds its document breakpoint only while the request has fewer than Anthropic's four", () => {
    const withTool = { ...payload(), tools: [{ name: "lookup", input_schema: { type: "object" }, cache_control: cache }] };
    // system + last tool + last user message = 3, so the documents' breakpoint is the fourth.
    const four = transformAnthropicPayload(withTool, plan({ documents: [TEXT_DOC] })) as ReturnType<typeof payload>;
    assert.equal(JSON.stringify(four).split("cache_control").length - 1, 4);
    // A request that already has four (a future pi-ai breakpoint) gets none from the kit: a fifth is a 400.
    const full = { ...withTool, messages: [{ role: "user", content: [{ type: "text", text: MARKER }, { type: "text", text: "Q", cache_control: cache }] }, { role: "assistant", content: [{ type: "text", text: "A" }] }, { role: "user", content: [{ type: "text", text: "Q2", cache_control: cache }] }] };
    assert.equal(JSON.stringify(full).split("cache_control").length - 1, 4);
    const capped = transformAnthropicPayload(full, plan({ documents: [TEXT_DOC] }));
    assert.equal(JSON.stringify(capped).split("cache_control").length - 1, 4, "no fifth breakpoint");
  });

  it("reuses the breakpoint pi-ai put on a tool when the system prompt has none", () => {
    const toolTtl = { type: "ephemeral", ttl: "1h" };
    const onlyTool = {
      ...payload(),
      system: [{ type: "text", text: "S" }],
      tools: [{ name: "lookup", input_schema: { type: "object" }, cache_control: toolTtl }],
      messages: [{ role: "user", content: [{ type: "text", text: MARKER }, { type: "text", text: "Q" }] }],
    };
    const next = transformAnthropicPayload(onlyTool, plan({ documents: [TEXT_DOC] })) as ReturnType<typeof payload>;
    assert.deepEqual(next.messages[0]?.content[0], { type: "text", text: TEXT_PART, cache_control: toolTtl });
  });

  it("forces one tool call for the response schema", () => {
    const next = transformAnthropicPayload(
      payload(),
      plan({ marker: undefined, documents: [], responseSchema: { name: "answer", schema: SCHEMA } }),
    ) as Record<string, unknown>;
    assert.deepEqual(next.tools, [{ name: "answer", description: "Respond with the answer as this tool's input.", input_schema: SCHEMA }]);
    assert.deepEqual(next.tool_choice, { type: "tool", name: "answer" });
  });

  it("pins OpenRouter's native file parser on OpenRouter only, replacing a caller's file-parser setting", () => {
    const withPlugins = { ...payload(), plugins: [{ id: "web" }, { id: "file-parser", pdf: { engine: "mistral-ocr" } }] };
    const toOpenRouter = transformAnthropicPayload(withPlugins, plan({ targetsOpenRouter: true })) as Record<string, unknown>;
    assert.deepEqual(toOpenRouter.plugins,[{ id: "web" }, { id: "file-parser", pdf: { engine: "native" } }]);
    const bare = transformAnthropicPayload(payload(), plan({ targetsOpenRouter: true })) as Record<string, unknown>;
    assert.deepEqual(bare.plugins, [{ id: "file-parser", pdf: { engine: "native" } }]);
    const kie = transformAnthropicPayload(payload(), plan({ targetsOpenRouter: false })) as Record<string, unknown>;
    assert.ok(!("plugins" in kie), "KIE and ToAPIs never get OpenRouter's plugins");
  });

  it("sends native structured output beside pi-ai's output_config, with thinking on and no forced tool call", () => {
    const next = transformAnthropicPayload(
      { ...payload(), thinking: { type: "adaptive" }, output_config: { effort: "high" } },
      plan({ marker: undefined, documents: [], responseSchema: { name: "answer", schema: SCHEMA }, nativeStructuredOutput: true }),
    ) as Record<string, unknown>;
    assert.deepEqual(next.output_config, {
      effort: "high",
      format: { type: "json_schema", schema: { ...SCHEMA, additionalProperties: false } },
    });
    assert.equal(next.tools, undefined);
    assert.equal(next.tool_choice, undefined);
    assert.deepEqual(next.thinking, { type: "adaptive" });
  });

  it("refuses a forced tool call while thinking is on", () => {
    assert.throws(
      () =>
        transformAnthropicPayload(
          { ...payload(), thinking: { type: "adaptive" } },
          plan({ marker: undefined, documents: [], responseSchema: { name: "answer", schema: SCHEMA } }),
        ),
      (error: unknown) => error instanceof TurnFailure && error.code === "UNSUPPORTED",
    );
  });

  it("fails when the marker is repeated across messages", () => {
    expectMarkerFailure(
      () =>
        transformAnthropicPayload(
          {
            messages: [
              { role: "user", content: [{ type: "text", text: MARKER }] },
              { role: "user", content: [{ type: "text", text: MARKER }] },
            ],
          },
          plan(),
        ),
      /appeared 2 times/,
    );
  });
});

describe("sanitizeSchemaForAnthropic", () => {
  it("strips the keywords native structured output rejects and closes every object, keeping property names", () => {
    const schema = {
      type: "object",
      properties: {
        maxLength: { type: "string", minLength: 1, maxLength: 9, format: "email" },
        tags: { type: "array", items: { type: "string", format: "color" }, minItems: 2, maxItems: 5 },
        score: { type: "number", minimum: 0, maximum: 1 },
        meta: { type: "object", additionalProperties: true, properties: { note: { type: "string" } } },
      },
      required: ["maxLength"],
    };
    assert.deepEqual(sanitizeSchemaForAnthropic(schema), {
      type: "object",
      properties: {
        maxLength: { type: "string", format: "email" },
        tags: { type: "array", items: { type: "string" } },
        score: { type: "number" },
        meta: { type: "object", properties: { note: { type: "string" } }, additionalProperties: false },
      },
      required: ["maxLength"],
      additionalProperties: false,
    });
    assert.deepEqual(sanitizeSchemaForAnthropic({ type: "array", items: { type: "string" }, minItems: 1 }), {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    });
    assert.equal(sanitizeSchemaForAnthropic(schema), sanitizeSchemaForAnthropic(schema), "cached by identity");
    assert.equal(schema.properties.score.minimum, 0, "the input is not mutated");
  });
});

describe("targetsOpenRouter", () => {
  const model = (provider: string, baseUrl: string) => ({ provider, baseUrl }) as Model<Api>;
  it("is true for the openrouter provider, whatever its base URL, and for a base URL on openrouter.ai", () => {
    assert.equal(targetsOpenRouter(model("openrouter", "https://proxy.example.com/openrouter")), true);
    assert.equal(targetsOpenRouter(model("custom", "https://openrouter.ai/api")), true);
    assert.equal(targetsOpenRouter(model("kie", "https://api.kie.ai/anthropic")), false);
    assert.equal(targetsOpenRouter(model("toapis", "https://toapis.com")), false);
    assert.equal(targetsOpenRouter(model("kie", "https://openrouter.ai.example.com")), false);
  });
});

describe("always-thinking Claude families", () => {
  it("matches Opus 5, Fable 5 and the 5.5 family with or without a provider prefix, dotted or dashed", () => {
    for (const id of [
      "claude-opus-5",
      "anthropic/claude-opus-5",
      "claude-fable-5",
      "anthropic/claude-fable-5.1",
      "claude-opus-5-20261001",
      "anthropic/claude-sonnet-5.5",
      "claude-haiku-5-5",
      "anthropic/claude-opus-5.5",
    ]) {
      assert.equal(isAlwaysThinkingClaude(id), true, id);
    }
  });

  it("does not match models whose thinking can be turned off", () => {
    for (const id of [
      "claude-sonnet-5",
      "anthropic/claude-sonnet-5",
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-8",
      "anthropic/claude-sonnet-4.6",
      "claude-opus-50",
      "gpt-5-5",
    ]) {
      assert.equal(isAlwaysThinkingClaude(id), false, id);
    }
  });
});

describe("OpenAI Responses payload transform", () => {
  const payload = () => ({
    model: "gpt-5-6-sol",
    input: [
      { role: "developer", content: "Be brief." },
      {
        role: "user",
        content: [
          { type: "input_text", text: MARKER },
          { type: "input_text", text: "Q1" },
        ],
      },
    ],
    text: { verbosity: "low" },
    stream: true,
  });

  it("replaces the marker with input_file / input_image parts", () => {
    const input = payload();
    const snapshot = structuredClone(input);
    const next = transformOpenAIResponsesPayload(
      input,
      plan({ documents: [TEXT_DOC, PDF_BY_URL, PDF_INLINE, PNG_BY_URL, PNG_INLINE] }),
    ) as ReturnType<typeof payload>;
    assert.deepEqual(next.input[1]?.content, [
      { type: "input_text", text: TEXT_PART },
      { type: "input_file", filename: "brief.pdf", file_url: "https://cdn.example.com/brief.pdf" },
      { type: "input_file", filename: "brief.pdf", file_data: "data:application/pdf;base64,JVBERg==" },
      { type: "input_image", detail: "auto", image_url: "https://cdn.example.com/logo.png" },
      { type: "input_image", detail: "auto", image_url: "data:image/png;base64,iVBORw==" },
      { type: "input_text", text: "Q1" },
    ]);
    assert.deepEqual(input, snapshot);
  });

  it("adds a strict json_schema text format and keeps other text options", () => {
    const next = transformOpenAIResponsesPayload(
      payload(),
      plan({ marker: undefined, documents: [], responseSchema: { name: "answer", schema: SCHEMA } }),
    ) as Record<string, unknown>;
    assert.deepEqual(next.text, { verbosity: "low", format: { type: "json_schema", name: "answer", schema: SCHEMA, strict: true } });
  });

  it("fails when the marker is missing", () => {
    expectMarkerFailure(
      () => transformOpenAIResponsesPayload({ input: [{ role: "user", content: [{ type: "input_text", text: "Q" }] }] }, plan()),
      /was not found/,
    );
  });

  it("checks every entry for the marker, as the other wires do, not only user entries with parts", () => {
    const [, user] = payload().input;
    // A plain-string entry that holds the marker fails: parts cannot replace part of a string.
    expectMarkerFailure(
      () => transformOpenAIResponsesPayload({ input: [{ role: "user", content: `${MARKER} Q1` }] }, plan()),
      /plain-text message/,
    );
    expectMarkerFailure(
      () => transformOpenAIResponsesPayload({ input: [{ role: "developer", content: `Be brief. ${MARKER}` }, user] }, plan()),
      /plain-text message/,
    );
    // A marker in another role's parts counts: next to the user's marker it is a repeat, and alone it is replaced.
    const developerMarker = { role: "developer", content: [{ type: "input_text", text: MARKER }] };
    expectMarkerFailure(() => transformOpenAIResponsesPayload({ input: [developerMarker, user] }, plan()), /appeared 2 times/);
    const next = transformOpenAIResponsesPayload({ input: [developerMarker] }, plan({ documents: [TEXT_DOC] })) as { input: unknown[] };
    assert.deepEqual(next.input, [{ role: "developer", content: [{ type: "input_text", text: TEXT_PART }] }]);
  });

  it("leaves every entry without the marker as it was: plain-string turns, assistant output and tool items", () => {
    const input = [
      { role: "developer", content: "Be brief." },
      {
        role: "user",
        content: [
          { type: "input_text", text: MARKER },
          { type: "input_text", text: "Q1" },
        ],
      },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "A1" }] },
      { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "found" },
      { role: "user", content: "Q2" },
    ];
    const next = transformOpenAIResponsesPayload({ input }, plan({ documents: [TEXT_DOC] })) as { input: unknown[] };
    assert.deepEqual(next.input, [
      input[0],
      {
        role: "user",
        content: [
          { type: "input_text", text: TEXT_PART },
          { type: "input_text", text: "Q1" },
        ],
      },
      ...input.slice(2),
    ]);
  });
});
