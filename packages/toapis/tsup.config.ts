import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  external: ["@earendil-works/pi-ai", "zod"],
  noExternal: ["@hk01/pi-ai-extra-internal"],
});
