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

// The sanitized form of a schema object never changes, and consumers usually pass the same
// schema object on every turn, so cache by identity rather than re-walking the tree each time.
const sanitizedCache = new WeakMap<object, unknown>();

/** A copy of `schema` that Gemini's `responseJsonSchema` accepts (no `minItems` / `maxItems`). */
export function sanitizeSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return stripUnsupported(schema);
  const cached = sanitizedCache.get(schema);
  if (cached !== undefined) return cached;
  const result = stripUnsupported(schema);
  sanitizedCache.set(schema, result);
  return result;
}
