/**
 * These tests are almost identical to webpack.test.ts; diff the files to see that the differences
 * are all API and types. The tests are copied primarily to avoid issues with TypeScript.
 */

import "./polyfill";

import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Console } from "node:console";
import { Writable } from "node:stream";

import { describe, expect, onTestFinished } from "vitest";

import { rspack } from "@rspack/core";
import merge, { mergeWithCustomize, customizeArray } from "webpack-merge";
import * as esModuleLexer from "es-module-lexer";

import GlobEntryPlugin from "../src/rspack.js";

import test from "./utils/testWithTmp.js";
import { writeFiles } from "./utils/files.js";

const replaceArrayMerge = mergeWithCustomize({
	customizeArray: customizeArray({ "*": "replace" }),
});

// Rspack doesn't export these types
type Compiler = any;
type Stats = {
	hasErrors(): boolean;
	toJson(options: Record<string, boolean>): Record<string, any>;
};
type WatchFn = (cb: (err: Error | null, result?: Stats) => void) => {
	close: (cb: (err: Error | null) => void) => void;
};

const mockConsole = new Console(new Writable());

const config = {
	// context added in each test
	entry: {},
	output: {
		// path added in each test
		clean: true,
		publicPath: "/",
		module: true,
		// enabledChunkLoadingTypes: ["import"],
		// chunkLoading: "import",
	},
	plugins: [GlobEntryPlugin({ patterns: "*.entry.js" })],
	infrastructureLogging: {
		console: mockConsole,
	},
	cache: false,
	experiments: {
		outputModule: true,
	},
};

async function setup(
	rootDir: string,
	options: {
		files?: Record<string, string>;
		config?: typeof config;
	} = {},
) {
	const {
		files = {
			"src/a.entry.js": "console.log('a'); export default 'a';",
			"src/b/b.entry.js": "console.log('b'); export default 'b';",
		},
		config: baseConfig = config,
	} = options;
	const extendedConfig = merge(baseConfig, {
		context: path.join(rootDir, "src"),
		output: { path: path.join(rootDir, "dist") },
	});

	const compiler = rspack(extendedConfig);

	onTestFinished(() => {
		return promisify(compiler.close.bind(compiler))();
	});

	await writeFiles(rootDir, files);

	return compiler;
}

function checkStats(stats?: Stats): asserts stats {
	expect(stats).toBeDefined();
	if (stats?.hasErrors()) {
		const { errors } = stats.toJson({
			all: false,
			errors: true,
			errorDetails: true,
			errorStack: true,
		});
		expect.soft(errors).toEqual([]);
	}
}

describe("run", () => {
	function run(compiler: Compiler) {
		const runPromise = promisify(compiler.run.bind(compiler));
		return runPromise();
	}

	test("doesn't crash", async ({ tmp }) => {
		const compiler = await setup(tmp);
		const stats = await run(compiler);
		checkStats(stats);
	});

	test("includes correct entrypoints", async ({ tmp }) => {
		const compiler = await setup(tmp);
		const stats = await run(compiler);
		checkStats(stats);

		const { entrypoints } = stats.toJson({ all: false, entrypoints: true });
		expect(Object.keys(entrypoints!).sort()).toEqual([
			"a.entry.js",
			"b/b.entry.js",
		]);
	});

	test("emits correct assets", async ({ tmp }) => {
		const compiler = await setup(tmp);
		const stats = await run(compiler);
		checkStats(stats);

		const { assets } = stats.toJson({
			all: false,
			assets: true,
		});
		expect(assets?.map((asset: { name: string }) => asset.name).sort()).toEqual(
			["a.entry.js.mjs", "b/b.entry.js.mjs", "importmap.json"],
		);
	});

	test("emits correct import map", async ({ tmp }) => {
		const compiler = await setup(tmp);
		const stats = await run(compiler);
		checkStats(stats);

		const importmap = await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8");

		expect(importmap).toBe(
			JSON.stringify({
				imports: {
					"a.entry.js": "/a.entry.js.mjs",
					"b/b.entry.js": "/b/b.entry.js.mjs",
				},
			}),
		);
	});

	test("emits unminified import map in development", async ({ tmp }) => {
		const compiler = await setup(tmp, {
			config: merge(config, { mode: "development" }),
		});
		const stats = await run(compiler);
		checkStats(stats);

		const importmap = await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8");

		expect(importmap).toBe(
			JSON.stringify(
				{
					imports: {
						"a.entry.js": "/a.entry.js.mjs",
						"b/b.entry.js": "/b/b.entry.js.mjs",
					},
				},
				null,
				2,
			),
		);
	});

	test("import map respects non-root public path", async ({ tmp }) => {
		const compiler = await setup(tmp, {
			config: merge(config, {
				output: { publicPath: "/public" },
			}),
		});
		const stats = await run(compiler);
		checkStats(stats);

		const importmap = await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8");

		expect(importmap).toBe(
			JSON.stringify({
				imports: {
					"a.entry.js": "/public/a.entry.js.mjs",
					"b/b.entry.js": "/public/b/b.entry.js.mjs",
				},
			}),
		);
	});

	test("emitted files preserve exports", async ({ tmp }) => {
		const compiler = await setup(tmp);
		const stats = await run(compiler);
		checkStats(stats);

		const { assets, entrypoints } = stats.toJson({
			all: false,
			assets: true,
			entrypoints: true,
		});
		const entryForA = entrypoints?.["a.entry.js"];
		expect(entryForA?.assets).toHaveProperty("length", 1);

		const assetForA = assets?.find(
			(asset) => asset.name === entryForA!.assets![0].name,
		);
		expect(assetForA).toBeDefined();

		const distA = await fs.readFile(`${tmp}/dist/${assetForA!.name}`, "utf-8");

		await esModuleLexer.init;
		const [, exports, , hasModuleSyntax] = esModuleLexer.parse(
			distA,
			assetForA!.name,
		);

		// the format could change; just ensure it's actually ESM and has a default export
		expect
			.soft(distA)
			.toMatchInlineSnapshot(
				`"var r={},e={};function t(o){var n=e[o];if(void 0!==n)return n.exports;var a=e[o]={exports:{}};return r[o](a,a.exports,t),a.exports}t.d=function(r,e){for(var o in e)t.o(e,o)&&!t.o(r,o)&&Object.defineProperty(r,o,{enumerable:!0,get:e[o]})},t.o=function(r,e){return Object.prototype.hasOwnProperty.call(r,e)},t.rv=function(){return"1.0.14"},t.ruid="bundler=rspack@1.0.14";var o={};t.d(o,{Z:function(){return n}}),console.log("a");let n="a";var a=o.Z;export{a as default};"`,
			);
		expect(hasModuleSyntax).toBe(true);
		expect(exports[0]).toHaveProperty("n", "default"); // n=name
		expect(distA).toMatch(/console\.log\(['"]a['"]\)/);
	});

	test("works without manually setting experiments", async ({ tmp }) => {
		const compiler = await setup(tmp, {
			config: merge(config, {
				output: { module: false },
				experiments: { outputModule: false },
			}),
		});
		const stats = await run(compiler);
		checkStats(stats);

		const { entrypoints } = stats.toJson({ all: false, entrypoints: true });
		expect(Object.keys(entrypoints!).sort()).toEqual([
			"a.entry.js",
			"b/b.entry.js",
		]);

		const { assets } = stats.toJson({
			all: false,
			assets: true,
		});
		expect(assets?.map((asset) => asset.name).sort()).toEqual([
			"a.entry.js.mjs",
			"b/b.entry.js.mjs",
			"importmap.json",
		]);
	});

	describe("HtmlWebpackPlugin", () => {
		test("injects import map into HtmlWebpackPlugin template", async ({
			tmp,
		}) => {
			const HtmlWebpackPlugin = (await import("html-webpack-plugin")).default;
			const compiler = await setup(tmp, {
				config: merge(config, {
					plugins: [new HtmlWebpackPlugin()],
				}),
			});
			const stats = await run(compiler);
			checkStats(stats);

			const html = await fs.readFile(`${tmp}/dist/index.html`, "utf-8");
			expect(html).toContain('<script type="importmap">');
		});

		test("doesn't inject import map into HtmlWebpackPlugin template if options.noHtmlWebpackPlugin", async ({
			tmp,
		}) => {
			const HtmlWebpackPlugin = (await import("html-webpack-plugin")).default;
			const compiler = await setup(tmp, {
				config: replaceArrayMerge(config, {
					mode: "development",
					plugins: [
						GlobEntryPlugin({
							patterns: "*.entry.js",
							noHtmlWebpackPlugin: true,
						}),
						new HtmlWebpackPlugin(),
					],
				}),
			});
			const stats = await run(compiler);
			checkStats(stats);

			const html = await fs.readFile(`${tmp}/dist/index.html`, "utf-8");
			expect(html).not.toContain('<script type="importmap">');
		});
	});

	describe("options", () => {
		test("importMapFileName", async ({ tmp }) => {
			const compiler = await setup(tmp, {
				config: replaceArrayMerge(config, {
					plugins: [
						GlobEntryPlugin({
							patterns: "*.entry.js",
							importMapFileName: "my-import-map.json",
						}),
					],
				}),
			});
			const stats = await run(compiler);
			checkStats(stats);

			const { assets } = stats.toJson({
				all: false,
				assets: true,
			});
			expect(
				assets?.map((asset: { name: string }) => asset.name).sort(),
			).toContain("my-import-map.json");
		});

		test("importMapPrefix", async ({ tmp }) => {
			const compiler = await setup(tmp, {
				config: replaceArrayMerge(config, {
					plugins: [
						GlobEntryPlugin({
							patterns: "*.entry.js",
							importMapPrefix: "~",
						}),
					],
				}),
			});
			const stats = await run(compiler);
			checkStats(stats);

			const importmap = JSON.parse(
				await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8"),
			);

			expect(importmap).toStrictEqual({
				imports: {
					"~/a.entry.js": "/a.entry.js.mjs",
					"~/b/b.entry.js": "/b/b.entry.js.mjs",
				},
			});
		});
	});
});

describe("watch", () => {
	function pushToPull<TCb, TReturn = void>(
		nodeStyleFn: (cb: (err: unknown, result?: TCb) => void) => TReturn,
	): [AsyncGenerator<Awaited<TCb> | undefined, void>, TReturn] {
		const pending: Array<Promise<TCb | undefined>> = [];
		let lastYielded: PromiseWithResolvers<TCb | undefined> | undefined;

		const cb = (err: unknown, result?: TCb) => {
			if (err != null) {
				if (lastYielded) {
					lastYielded.reject(err);
					lastYielded = undefined;
				} else {
					pending.push(Promise.reject(err));
				}
			} else {
				if (lastYielded) {
					lastYielded.resolve(result);
					lastYielded = undefined;
				} else {
					pending.push(Promise.resolve(result));
				}
			}
		};

		async function* generator() {
			while (true) {
				if (pending.length === 0) {
					lastYielded = Promise.withResolvers<TCb | undefined>();
					yield lastYielded.promise;
				} else {
					yield pending.shift()!;
				}
			}
		}

		const result: TReturn = nodeStyleFn(cb);

		// pass cb to node-style fn, which will start providing values to the generator
		return [generator(), result];
	}

	test("picks up new files", async ({ tmp, onTestFailed, onTestFinished }) => {
		const compiler = await setup(tmp);

		const [generator, watching] = pushToPull(
			compiler.watch.bind(compiler, {}) as WatchFn,
		);
		onTestFinished(() => promisify(watching.close.bind(watching))());
		onTestFailed(() => {
			generator.return();
		});

		// first build
		let iteratorResult = await generator.next();
		if (iteratorResult.done) {
			expect.fail();
		}
		checkStats(iteratorResult.value);
		let { entrypoints } = iteratorResult.value.toJson({
			all: false,
			entrypoints: true,
		});
		expect(Object.keys(entrypoints!).toSorted()).toEqual([
			"a.entry.js",
			"b/b.entry.js",
		]);

		// add new entrypoint
		await writeFiles(tmp, {
			"src/c/c/c.entry.js": "console.log('c'); export default 'c';",
		});

		// second build
		iteratorResult = await generator.next();
		if (iteratorResult.done) {
			expect.fail();
		}
		checkStats(iteratorResult.value);
		({ entrypoints } = iteratorResult.value.toJson({
			all: false,
			entrypoints: true,
		}));
		expect(Object.keys(entrypoints!).toSorted()).toEqual([
			"a.entry.js",
			"b/b.entry.js",
			"c/c/c.entry.js",
		]);
	});

	test("emits updated import map", async ({
		tmp,
		onTestFailed,
		onTestFinished,
	}) => {
		const compiler = await setup(tmp);

		const [generator, watching] = pushToPull(
			compiler.watch.bind(compiler, {}) as WatchFn,
		);
		onTestFinished(() => promisify(watching.close.bind(watching))());
		onTestFailed(() => {
			generator.return();
		});

		// first build
		let iteratorResult = await generator.next();
		if (iteratorResult.done) {
			expect.fail();
		}
		checkStats(iteratorResult.value);

		let importmap = JSON.parse(
			await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8"),
		);
		expect(importmap).toStrictEqual({
			imports: {
				"a.entry.js": "/a.entry.js.mjs",
				"b/b.entry.js": "/b/b.entry.js.mjs",
			},
		});

		// add new entrypoint
		await writeFiles(tmp, {
			"src/c/c/c.entry.js": "console.log('c'); export default 'c';",
		});

		// second build
		iteratorResult = await generator.next();
		if (iteratorResult.done) {
			expect.fail();
		}
		checkStats(iteratorResult.value);

		importmap = JSON.parse(
			await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8"),
		);
		expect(importmap).toStrictEqual({
			imports: {
				"a.entry.js": "/a.entry.js.mjs",
				"b/b.entry.js": "/b/b.entry.js.mjs",
				"c/c/c.entry.js": "/c/c/c.entry.js.mjs",
			},
		});
	});
});
