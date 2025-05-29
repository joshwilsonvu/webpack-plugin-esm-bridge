import "./polyfill";

import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Console } from "node:console";
import { Writable } from "node:stream";

import { describe, expect, onTestFinished } from "vitest";

import webpack from "webpack";
import { merge, mergeWithCustomize, customizeArray } from "webpack-merge";
import * as esModuleLexer from "es-module-lexer";

import GlobEntryPlugin from "../src/index.js";

import test from "./utils/testWithTmp.js";
import { writeFiles } from "./utils/files.js";

const replaceArrayMerge = mergeWithCustomize({
	customizeArray: customizeArray({ "*": "replace" }),
});

const mockConsole = new Console(new Writable());

const config: webpack.Configuration = {
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
	watchOptions: {
		poll: 50,
	},
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

	const compiler = webpack(extendedConfig);

	onTestFinished(() => {
		return promisify(compiler.close.bind(compiler))();
	});

	await writeFiles(rootDir, files);

	return compiler;
}

function checkStats(stats?: webpack.Stats): asserts stats {
	expect(stats).toBeDefined();
	if (stats?.hasErrors()) {
		const { errors } = stats.toJson({
			all: false,
			errors: true,
			errorDetails: true,
			errorStack: true,
		});
		expect.soft(errors).toStrictEqual([]);
	}
}

async function checkImportMap(
	tmp: string,
	toBe = JSON.stringify({
		imports: {
			"a.entry.js": "/a.entry.js.mjs",
			"b/b.entry.js": "/b/b.entry.js.mjs",
		},
	}),
): Promise<void> {
	const importmap = await fs.readFile(`${tmp}/dist/importmap.json`, "utf-8");

	expect(importmap).toBe(toBe);
}

describe("run", () => {
	function run(compiler: webpack.Compiler) {
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
		expect(Object.keys(entrypoints!).sort()).toStrictEqual([
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
		expect(assets?.map((asset) => asset.name).sort()).toStrictEqual([
			"a.entry.js.mjs",
			"b/b.entry.js.mjs",
			"importmap.json",
		]);
	});

	test("emits correct import map", async ({ tmp }) => {
		const compiler = await setup(tmp);
		const stats = await run(compiler);
		checkStats(stats);

		await checkImportMap(tmp);
	});

	test("emits unminified import map in development", async ({ tmp }) => {
		const compiler = await setup(tmp, {
			config: merge(config, { mode: "development" }),
		});
		const stats = await run(compiler);
		checkStats(stats);

		await checkImportMap(
			tmp,
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

		await checkImportMap(
			tmp,
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
				`"var e={d:(o,r)=>{for(var t in r)e.o(r,t)&&!e.o(o,t)&&Object.defineProperty(o,t,{enumerable:!0,get:r[t]})},o:(e,o)=>Object.prototype.hasOwnProperty.call(e,o)},o={};e.d(o,{A:()=>r}),console.log("a");const r="a",t=o.A;export{t as default};"`,
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
		expect(Object.keys(entrypoints!).sort()).toStrictEqual([
			"a.entry.js",
			"b/b.entry.js",
		]);

		const { assets } = stats.toJson({
			all: false,
			assets: true,
		});
		expect(assets?.map((asset) => asset.name).sort()).toStrictEqual([
			"a.entry.js.mjs",
			"b/b.entry.js.mjs",
			"importmap.json",
		]);
	});

	test("works with single runtime chunk", async ({ tmp }) => {
		const compiler = await setup(tmp, {
			config: merge(config, {
				optimization: {
					runtimeChunk: "single",
				},
			}),
		});

		const stats = await run(compiler);
		checkStats(stats);

		await checkImportMap(tmp);
	});

	test("works with multiple runtime chunks", async ({ tmp }) => {
		const compiler = await setup(tmp, {
			config: merge(config, {
				optimization: {
					runtimeChunk: "multiple",
				},
			}),
		});

		const stats = await run(compiler);
		checkStats(stats);

		await checkImportMap(tmp);
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
		describe("importMap", () => {
			test("fileName", async ({ tmp }) => {
				const compiler = await setup(tmp, {
					config: replaceArrayMerge(config, {
						plugins: [
							GlobEntryPlugin({
								patterns: "*.entry.js",
								importMap: {
									fileName: "my-import-map.json",
								},
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

			test("prefix", async ({ tmp }) => {
				const compiler = await setup(tmp, {
					config: replaceArrayMerge(config, {
						plugins: [
							GlobEntryPlugin({
								patterns: "*.entry.js",
								importMap: {
									prefix: "~",
								},
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

			test("trimExtension", async ({ tmp }) => {
				const compiler = await setup(tmp, {
					config: replaceArrayMerge(config, {
						plugins: [
							GlobEntryPlugin({
								patterns: "*.entry.js",
								importMap: {
									trimExtension: true,
								},
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
						"a.entry": "/a.entry.js.mjs",
						"b/b.entry": "/b/b.entry.js.mjs",
					},
				});
			});

			test("integrity", async ({ tmp }) => {
				const compiler = await setup(tmp, {
					config: replaceArrayMerge(config, {
						plugins: [
							GlobEntryPlugin({
								patterns: "*.entry.js",
								importMap: {
									integrity: true,
								},
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
						"a.entry.js": "/a.entry.js.mjs",
						"b/b.entry.js": "/b/b.entry.js.mjs",
					},
					integrity: {
						"/a.entry.js.mjs": expect.stringMatching(/^sha384-.{60,}$/),
						"/b/b.entry.js.mjs": expect.stringMatching(/^sha384-.{60,}$/),
					},
				});
			});

			test("onCreate", async ({ tmp }) => {
				const compiler = await setup(tmp, {
					config: replaceArrayMerge(config, {
						plugins: [
							GlobEntryPlugin({
								patterns: "*.entry.js",
								importMap: {
									async onCreate(importMap) {
										await Promise.resolve();
										importMap.imports["something-extra"] = "/something-nice";
									},
								},
							}),
						],
					}),
				});
				const stats = await run(compiler);
				checkStats(stats);

				const importmap = await fs.readFile(
					`${tmp}/dist/importmap.json`,
					"utf-8",
				);

				expect(importmap).toBe(
					JSON.stringify({
						imports: {
							"a.entry.js": "/a.entry.js.mjs",
							"b/b.entry.js": "/b/b.entry.js.mjs",
							"something-extra": "/something-nice",
						},
					}),
				);
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

		const [generator, watching] = pushToPull(compiler.watch.bind(compiler, {}));
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
		expect(Object.keys(entrypoints!).toSorted()).toStrictEqual([
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
		expect(Object.keys(entrypoints!).toSorted()).toStrictEqual([
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

		const [generator, watching] = pushToPull(compiler.watch.bind(compiler, {}));
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
