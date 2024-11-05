import type { Options } from "tsup";

export default {
  entry: ["src/index.ts", "src/rspack.ts"],
  clean: true,
  format: ["cjs", "esm"],
  dts: true,
  splitting: true,
  sourcemap: true,
  treeshake: true,
} satisfies Options;
