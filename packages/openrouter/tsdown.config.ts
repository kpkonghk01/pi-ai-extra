import { defineConfig, type UserConfig } from "tsdown";

// Only the `/pi-ai` entry, ESM only (ADR 0004's DATA-4583 amendment): pi-ai already serves
// OpenRouter's images, so there is no helper for a main entry to hold, and pi-ai is ESM-only.
const config: UserConfig = defineConfig({
  entry: { "pi-ai": "src/pi-ai/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: { generator: "oxc" },
  sourcemap: true,
  clean: true,
  deps: { alwaysBundle: [/^@hk01\/pi-ai-extra-internal/] },
});

export default config;
