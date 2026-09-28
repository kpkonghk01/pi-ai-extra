import { defineConfig, type UserConfig } from "tsdown";

// Main entry: dual CJS + ESM, no pi-ai import. `/pi-ai` entry: exported for ESM only
// (pi-ai is ESM-only); its CJS twin is built but deliberately not packed or exported.
const config: UserConfig = defineConfig({
  entry: { index: "src/index.ts", "pi-ai": "src/pi-ai/index.ts" },
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  dts: { generator: "oxc" },
  sourcemap: true,
  clean: true,
  deps: { alwaysBundle: [/^@hk01\/pi-ai-extra-internal/] },
});

export default config;
