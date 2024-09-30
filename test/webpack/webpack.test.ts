import { promisify } from "node:util";

import { vi, expect, test } from "vitest";
import { fs, vol } from "memfs";

import webpack from "webpack";
import GlobEntryPlugin from "../../src/webpack";

const config = {
	context: "/app",
	entry: {},
	plugins: [GlobEntryPlugin({ patterns: "*.entry.js" })],
} satisfies webpack.Configuration;

function setup(files?: Record<string, string>) {
	vol.fromJSON(
		files ?? {
			"a.entry.js": "export default 1",
			"b.entry.js": "export default 2",
		},
		"/app",
	);

	const compiler = webpack(config);
	compiler.inputFileSystem = fs as any;
	compiler.outputFileSystem = fs as any;

	const run = promisify(compiler.run.bind(compiler));

	return run;
}

test("doesn't crash", async () => {
	const run = setup();

	const stats = (await run())?.toJson({ all: false, entrypoints: true });
	expect(stats).toBeDefined();
	expect(stats?.entrypoints).toBeDefined();
});


test("includes correct entrypoints", async () => {
	const run = setup();

	const stats = (await run())?.toJson({ all: false, entrypoints: true });
	expect(Object.keys(stats?.entrypoints!).toSorted()).toEqual([
		"a.entry.js",
		"b.entry.js",
	]);
});

test("emits correct assets", async () => {
	const run = setup();

	const stats = (await run())?.toJson({ all: false, assets: true, cachedAssets: true });
	expect(stats?.assets?.map(asset => asset.name)).toEqual([
		"a.entry.js.mjs",
		"b.entry.js.mjs",
    "importmap.json"
	]);
});
