/*
 * Ported from data-gen-ai-portal `src/lib/gem/providers/gemini.ts`.
 *
 * The schema is sent as `responseJsonSchema` (Gemini's native JSON Schema input), not
 * `responseSchema` (an OpenAPI-subset `Schema` type). A consumer's schema is plain JSON Schema,
 * for example from Zod's `toJSONSchema()`; `responseSchema` tolerates that only on the streaming
 * path, where the SDK converts it, and rejects it with a 400 on the non-streaming one.
 * `responseJsonSchema` accepts `$schema`, `additionalProperties`, `format`, `pattern`,
 * `minLength`, `enum` and `minimum`/`maximum`, but rejects array length bounds (`minItems` /
 * `maxItems`, which Zod's `.length()` / `.max()` emit) with a 400 "Request contains an invalid
 * argument". Those are stripped; array sizes are still steered by the prompt and validated by
 * the consumer.
 */
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set(["minItems", "maxItems"]);

// Keys whose value is a map of arbitrary property names to subschemas. The names are
// user-chosen (a property may legitimately be named "minItems"), not JSON Schema keywords, so
// the subschemas are sanitized but a name is never dropped.
const SCHEMA_NAME_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function stripUnsupported(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (SCHEMA_NAME_MAPS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, stripUnsupported(sub)]));
    } else {
      out[key] = stripUnsupported(value);
    }
  }
  return out;
}

/** Keywords whose value is a map of names to subschemas (pi-ai 1.5's `JSON_SCHEMA_NAME_MAPS`). */
const SUBSCHEMA_NAME_MAPS = new Set([...SCHEMA_NAME_MAPS, "dependentSchemas", "dependencies"]);

/** Keywords whose value is a subschema or an array of them, not literal data (pi-ai 1.5's `JSON_SCHEMA_SUBSCHEMAS`). */
const SUBSCHEMA_KEYS = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "items",
  "prefixItems",
  "additionalItems",
  "unevaluatedItems",
  "contains",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
]);

/**
 * A string or number `const` as a one-value `enum`, walking subschemas only, so literal data such
 * as a `default` is left alone. Gemini ignores `const` in `responseJsonSchema` but honours `enum`:
 * live on 2026-11-19, gemini-3.8-flash on Agent Platform and AI Studio kept a value the schema's
 * `const` forbade 4 of 4 times and a one-value `enum` 4 of 4 times. pi-ai 1.5 rewrites tool
 * schemas the same way (`rewriteConstAsEnum` in its Google adapter, not exported).
 */
function rewriteConstAsEnum(schema: unknown, isNameMap = false): unknown {
  if (Array.isArray(schema)) return schema.map((item) => rewriteConstAsEnum(item));
  if (!schema || typeof schema !== "object") return schema;
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema as Record<string, unknown>).map(([key, value]) => {
      if (isNameMap || SUBSCHEMA_KEYS.has(key)) return [key, rewriteConstAsEnum(value)];
      if (SUBSCHEMA_NAME_MAPS.has(key)) return [key, rewriteConstAsEnum(value, true)];
      return [key, value];
    }),
  );
  if (!isNameMap && "const" in result && result.enum === undefined && (typeof result.const === "string" || typeof result.const === "number")) {
    const { const: value, ...rest } = result;
    return { ...rest, enum: [value] };
  }
  return result;
}

// The sanitized form of a schema object never changes, and consumers usually pass the same
// schema object on every turn, so cache by identity rather than re-walking the tree each time.
const sanitizedCache = new WeakMap<object, unknown>();

/**
 * A copy of `schema` that Gemini's `responseJsonSchema` accepts and honours: no `minItems` /
 * `maxItems`, and a string or number `const` as a one-value `enum`.
 */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return stripUnsupported(schema);
  const cached = sanitizedCache.get(schema);
  if (cached !== undefined) return cached;
  const result = rewriteConstAsEnum(stripUnsupported(schema));
  sanitizedCache.set(schema, result);
  return result;
}
