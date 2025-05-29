import type { Options } from "tsup";

export default {
	entry: ["src/index.ts", "src/rspack.ts"],
	clean: true,
	format: ["cjs", "esm"],
	dts: true,
	treeshake: true,
	// globby is ESM-only, and that normally works find as long as it's dynamically imported in the
	// CJS build. But ****ing Webpack runs plugins downstream of a `new Function('<function code>')
	// for some reason. I think Nodes run that in a context similar to its `vm` module, which leads to
	// `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` / "TypeError: A dynamic import callback was not
	// specified." That means we can't `require('globby')` _nor_ `await import('globby')`. So it has
	// to be bundled.
	noExternal: ["globby"],
} satisfies Options;
