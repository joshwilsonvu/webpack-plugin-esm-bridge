import type { Options } from "tsup";

export default {
	entry: ["src/*.ts", "!src/index.ts"],
	clean: true,
	format: ["cjs", "esm"],
	dts: true,
	cjsInterop: true,
	splitting: true,
	sourcemap: true,
	onSuccess: "npm run build:fix",
} satisfies Options;
