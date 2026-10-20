/*
 * Anthropic's native structured output (`output_config.format`, type `json_schema`) compiles the
 * schema into a grammar and answers a schema with an unsupported keyword with a 400
 * (https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations):
 * numeric bounds (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`),
 * string lengths (`minLength`, `maxLength`), array constraints beyond `minItems` of 0 or 1,
 * `additionalProperties` other than `false`, and string formats outside its list. The SDK
 * helpers strip those and validate the answer afterwards; the kit strips them the same way, and
 * the consumer validates the answer against its own schema.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

// Keys whose value maps arbitrary (user-chosen) names to subschemas: the names are kept.
const SCHEMA_NAME_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function sanitize(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitize);
  if (!schema || typeof schema !== "object") return schema;
  const input = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "minItems" && !(value === 0 || value === 1)) continue;
    if (key === "format" && typeof value === "string" && !SUPPORTED_FORMATS.has(value)) continue;
    if (key === "additionalProperties") continue;
    if (SCHEMA_NAME_MAPS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, sanitize(sub)]));
    } else {
      out[key] = sanitize(value);
    }
  }
  const isObject = input.type === "object" || (Array.isArray(input.type) && input.type.includes("object")) || "properties" in input;
  if (isObject) out.additionalProperties = false;
  return out;
}

// The sanitized form of a schema object never changes, and consumers usually pass the same schema
// object on every turn, so cache by identity rather than re-walking the tree each time.
const sanitizedCache = new WeakMap<object, unknown>();

/** A copy of `schema` that Anthropic's native structured output accepts. */
export function sanitizeSchemaForAnthropic(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return sanitize(schema);
  const cached = sanitizedCache.get(schema);
  if (cached !== undefined) return cached;
  const result = sanitize(schema);
  sanitizedCache.set(schema, result);
  return result;
}
