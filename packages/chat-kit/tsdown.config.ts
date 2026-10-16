import { defineConfig, type UserConfig } from "tsdown";

// One ESM-only entry: the kit runs on pi-ai, which is ESM-only, and is server-only (no browser
// or React entry). Every npm import (zod, pi-ai and the provider packages) stays external; the
// private internal package's rate helpers are bundled, as in the provider packages.
const config: UserConfig = defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  dts: { generator: "oxc" },
  sourcemap: true,
  clean: true,
  deps: { neverBundle: true, alwaysBundle: [/^@hk01\/pi-ai-extra-internal/] },
});

export default config;
