/** A JSON object (not `null`, not an array), as read from a provider payload or stream event. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
