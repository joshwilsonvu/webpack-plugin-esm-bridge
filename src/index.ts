import path from "node:path";
import process from "node:process";
import { globby } from "globby";

import { type UnpluginFactory, createUnplugin } from "unplugin";
import type * as Webpack from "webpack";
import type * as Rspack from "@rspack/core";
import type * as Rollup from "rollup";
import type * as Rolldown from "rolldown";
import type { Options } from "./types";

type WebpackEntries = Record<
	string,
	Omit<Rspack.EntryDescriptionNormalized, "filename" | "publicPath">
>;

interface PluginContext {
	warn: (msg: string) => void;
	error: (msg: string) => never;
}

const cwd = process.cwd();
const formatPath = (file: string, base = cwd): string =>
	path.posix.relative(base, file).replace(/^\.\//, "/");
// TODO
const formatAsset = (file: string, outputBase: string): string =>
	`${outputBase}/${file}`.replace(/\\|\/\//g, "/").replace(/\.\//g, "");

function loadPaths(
	patterns: Array<string>,
	base = cwd,
): Promise<Array<string>> {
	if (patterns.length === 0) {
		return Promise.resolve([]);
	}
	return globby(patterns, { onlyFiles: true, cwd: base, unique: true });
}

export const unpluginFactory: UnpluginFactory<Options | undefined> = (
	options,
) => {
	options ??= { patterns: [] };
	options.patterns ??= [];

	const patterns =
		typeof options.patterns === "string"
			? [options.patterns]
			: options.patterns;
	const importMapFileName = options.importMapFileName ?? "importmap.json";

	// *********** Shared ***********
	let _paths: Array<string> | null = null;
	async function getPaths(): Promise<Array<string>> {
		if (_paths == null) {
			_paths = await loadPaths(patterns);
		}
		return _paths;
	}
	async function getFreshPaths(): Promise<Array<string>> {
		_paths = await loadPaths(patterns);
		return _paths;
	}

	// *********** Webpack / Rspack ***********
	const loadEntries = async (base?: string): Promise<WebpackEntries> =>
		(await getFreshPaths()).reduce((acc, p) => {
			acc[formatPath(p, base)] = {
				import: [p],
				asyncChunks: true,
				chunkLoading: "import",
			};
			return acc;
		}, {} as WebpackEntries);

	const generateImportMap = async (
		compilation: Webpack.Compilation | Rspack.Compilation,
	): Promise<Record<string, string> | null> => {
		const stats = compilation.getStats().toJson({
			all: false,
			entrypoints: true,
			publicPath: true,
		});
		if (stats.entrypoints != null) {
			const pathsSet = new Set(await getPaths());
			const imports = Object.entries(stats.entrypoints)
				.filter(([entrypoint]) => pathsSet.has(entrypoint))
				.reduce(
					(imports, [entrypoint, desc]) => {
						const outputFile = desc.assets?.filter(
							(asset) =>
								!/\.(?:map|gz|br)$/.test(asset.name) && !("info" in asset),
						);
						if ((outputFile?.length ?? 0) > 1) {
							throw new Error(`Multiple assets found for entry ${entrypoint}`);
						}
						if ((outputFile?.length ?? 0) === 1) {
							const publicPath =
								stats.publicPath == null || stats.publicPath === "auto"
									? "/"
									: stats.publicPath;

							imports[entrypoint] = formatAsset(
								// biome-ignore lint/style/noNonNullAssertion: already checked
								outputFile![0].name,
								publicPath,
							);
						}
						return imports;
					},
					{} as Record<string, string>,
				);

			return imports;
		}
		return null;
	};

	// *********** Vite / Rollup / Rolldown ***********
	function objectifyInput(input: Rollup.InputOption): Record<string, string> {
		if (typeof input === "string") {
			return { [input]: input };
		}
		if (Array.isArray(input)) {
			return Object.fromEntries(input.map((str) => [str, str]));
		}
		return input;
	}

	const rollup = (() => {
		let originalInputNormalized: Record<string, string> | undefined;
		return {
			options(options: Rollup.InputOptions | Rolldown.InputOptions) {
				options.input ??= {};
				options.input = objectifyInput(options.input);
				originalInputNormalized ??= options.input;
			},
			async buildStart(
				this: PluginContext,
				options:
					| Rollup.NormalizedInputOptions
					| Rolldown.NormalizedInputOptions,
			) {
				// I think it's okay to change entry in `buildStart`?
				const input = structuredClone(originalInputNormalized);
				if (
					input != null &&
					typeof input === "object" &&
					!Array.isArray(input)
				) {
					// Load it up!
					(await getFreshPaths()).forEach((p) => {
						input[formatPath(p)] ??= p;
					});
					options.input = input;
				} else {
					this.warn("Internal error: options.input should be an object.");
				}
			},
			renderStart(
				this: PluginContext,
				options: Rollup.OutputOptions | Rolldown.OutputOptions,
			) {
				if (
					options.format &&
					!["es", "esm", "module"].includes(options.format)
				) {
					this.error(
						`unplugin-glob-entry requires output.format: 'module'. Either remove output.format or set it to 'module'.`,
					);
				}
			},
		} satisfies Partial<Rollup.Plugin> | Partial<Rolldown.Plugin>;
	})();

	return {
		name: "unplugin-glob-entry",
		enforce: "pre",

		webpack(compiler) {
			const logger = compiler.getInfrastructureLogger?.("glob-entry") ?? null;

			// Don't know where's best to modify options, trying synchronously.
			if (!compiler.options.experiments.outputModule) {
				logger?.warn(
					"Setting experiments.outputModule = true for native import support.",
				);
				compiler.options.experiments.outputModule = true;
			}
			if (!compiler.options.output.module) {
				logger?.warn("Setting output.module = true for native import support.");
				compiler.options.output.module = true;
			}

			// Add glob results as entry points. Nice of Webpack to include this!
			new compiler.webpack.DynamicEntryPlugin(compiler.context, () =>
				loadEntries(compiler.context),
			).apply(compiler);

			// Emit an import map file to be included in the HTML
			compiler.hooks.compilation.tap("glob-entry", (compilation) => {
				compilation.hooks.processAssets.tapPromise(
					{
						name: "StatsPlugin",
						// There are several stages where Webpack plugins can modify assets; this is the
						// last one, intended for "creating assets for the reporting purposes"
						stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
					},
					async (assets) => {
						const importmap = await generateImportMap(compilation);
						if (importmap != null) {
							assets[importMapFileName] =
								new compiler.webpack.sources.OriginalSource(
									JSON.stringify(importmap),
									importMapFileName,
								);
						}
					},
				);
			});

			// TODO: integrate with html-webpack-plugin, write import map to HTML
		},

		rspack(compiler) {
			// Incredible of Rspack to match internal Webpack plugins!
			new compiler.rspack.DynamicEntryPlugin(compiler.context, () =>
				loadEntries(compiler.context),
			).apply(compiler);
		},

		// A little type magic lets us use the exact same object
		rollup,
		rolldown: rollup,

		// No notion of "entry" in Vite development mode, only build
		vite: {
			async config(config, env) {
				if (env.command === "build") {
					config.build ??= {};
					config.build.rollupOptions ??= {};
					const input = (config.build.rollupOptions.input = objectifyInput(
						config.build.rollupOptions.input ?? {},
					));
					// Load it up!
					(await getFreshPaths()).forEach((p) => {
						input[formatPath(p)] ??= p;
					});
				}
			},
		},

		farm: {
			async config(config) {
				config.compilation ??= {};
				const input = (config.compilation.input ??= {});
				// Load it up!
				(await getFreshPaths()).forEach((p) => {
					input[formatPath(p)] ??= p;
				});
				return config;
			},
		},
	};
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);

export default unplugin;
