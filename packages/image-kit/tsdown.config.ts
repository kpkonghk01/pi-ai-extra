import { defineConfig, type UserConfig } from "tsdown";

// Four dual CJS + ESM entries. `server` imports the provider packages; `index`, `browser` and
// `react` never do, so browser bundles stay free of provider code. Every npm import (the
// provider packages and React, all peer dependencies) stays external.
const config: UserConfig = defineConfig({
  entry: { index: "src/index.ts", server: "src/server.ts", browser: "src/browser.ts", react: "src/react.tsx" },
  format: ["esm", "cjs"],
  platform: "node",
  target: "node22",
  dts: { generator: "oxc" },
  sourcemap: true,
  clean: true,
  deps: { neverBundle: true },
});

export default config;
