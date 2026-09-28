import type { ProviderAuth } from "@earendil-works/pi-ai";

/**
 * API-key auth that resolves only the key passed to the factory. It never reads
 * environment variables, credential stores or files.
 */
export function explicitApiKeyAuth(providerName: string, apiKey: string): ProviderAuth {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new TypeError(`${providerName}: apiKey is required and must be passed explicitly from server-side configuration.`);
  }
  return {
    apiKey: {
      name: `${providerName} API key`,
      resolve: async () => ({ auth: { apiKey }, source: "explicit apiKey" }),
    },
  };
}
