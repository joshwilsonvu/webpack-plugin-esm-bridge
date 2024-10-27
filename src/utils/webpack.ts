import type * as Webpack from "webpack";
import type * as Rspack from "@rspack/core";
import type { Options } from "../types.js";
import { formatAsset, formatPath, loadPaths } from "./paths.js";

const PLUGIN_NAME = "glob-entry";

type WebpackEntries = Record<
	string,
	Omit<Rspack.EntryDescriptionNormalized, "filename" | "publicPath">
>;

export default function WebpackPluginGlobEntry(options: Options) {
	const patterns = options.patterns
		? typeof options.patterns === "string"
			? [options.patterns]
			: options.patterns
		: [];

	const importMapFileName = options.importMapFileName ?? "importmap.json";
	const importMapPrefix = (options.importMapPrefix ?? "").replace(/\/$/, "");

	let _paths: Array<string> | null = null; // cache
	async function getFreshPaths(
		compiler: Webpack.Compiler | Rspack.Compiler,
	): Promise<Array<string>> {
		_paths = await loadPaths(patterns, {
			baseNameMatch: true,
			cwd: compiler.context,
			fs: (compiler.inputFileSystem ?? (await import("node:fs"))) as any,
		});
		return _paths;
	}
	async function getPaths(compiler: Webpack.Compiler | Rspack.Compiler) {
		if (_paths == null) {
			if (patterns.length === 0) {
				_paths = [];
			} else {
				return getFreshPaths(compiler);
			}
		}
		return _paths;
	}

	function getDynamicEntries(paths: Array<string>): WebpackEntries {
		return paths.reduce((acc, p) => {
			acc[formatPath(p)] = {
				import: [`./${p}`],
				asyncChunks: true,
				library: {
					type: "module",
				},
				// chunkLoading: "import-scripts",
			};
			return acc;
		}, {} as WebpackEntries);
	}

	async function generateImportMap(
		compilation: Webpack.Compilation | Rspack.Compilation,
	): Promise<{ imports: Record<string, string> } | null> {
		const stats = compilation.getStats().toJson({
			all: false,
			entrypoints: true,
			publicPath: true,
		});
		const logger = compilation.getLogger(PLUGIN_NAME);

		if (stats.publicPath === "auto") {
			logger.warn('`publicPath` is set to "auto", can\'t emit import map.');
			return null;
		}

		if (stats.entrypoints != null) {
			const pathsSet = new Set(await getPaths(compilation.compiler));
			const imports = Object.entries(stats.entrypoints)
				.filter(([entrypoint]) => pathsSet.has(entrypoint))
				.reduce(
					(imports, [entrypoint, desc]) => {
						if (importMapPrefix) {
							entrypoint = `${importMapPrefix}/${entrypoint}`;
						}
						const outputFile = desc.assets?.filter(
							(asset) =>
								!/\.(?:map|gz|br)$/.test(asset.name) && !("info" in asset),
						);
						if (outputFile && outputFile.length > 1) {
							throw new Error(`Multiple assets found for entry ${entrypoint}`);
						}
						if (outputFile && outputFile.length === 1) {
							imports[entrypoint] = formatAsset(
								outputFile[0].name,
								stats.publicPath ?? "/",
							);
						}
						return imports;
					},
					{} as Record<string, string>,
				);

			return { imports };
		}
		return null;
	}

	return {
		apply(compiler: Webpack.Compiler | Rspack.Compiler): void {
			const logger = compiler.getInfrastructureLogger?.(PLUGIN_NAME) ?? null;

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
			compiler.options.output.enabledLibraryTypes ??= [];
			if (!compiler.options.output.enabledLibraryTypes.includes("module")) {
				compiler.options.output.enabledLibraryTypes.push("module");
			}

			// Add glob results as entry points. Nice of Webpack to include this!
			new compiler.webpack.DynamicEntryPlugin(compiler.context, async () =>
				getDynamicEntries(await getFreshPaths(compiler)),
			).apply(compiler as any);

			let HtmlWebpackPlugin: typeof import("html-webpack-plugin");
			compiler.hooks.beforeCompile.tapPromise("glob-entry", async () => {
				if (!options.noHtmlWebpackPlugin) {
					try {
						HtmlWebpackPlugin = (await import("html-webpack-plugin")).default;
					} catch {}
				}
			});

			// Emit an import map file to be included in the HTML
			compiler.hooks.compilation.tap("glob-entry", (compilation) => {
				const minify =
					compiler.options.optimization?.minimize ??
					compiler.options.mode === "production";

				// hard to say when the import map will be generated, cache here per compilation
				let importmap:
					| Awaited<ReturnType<typeof generateImportMap>>
					| null
					| undefined;
				const formatImportmap = () =>
					minify
						? JSON.stringify(importmap)
						: JSON.stringify(importmap, null, 2);

				compilation.hooks.processAssets.tapPromise(
					{
						name: "StatsPlugin",
						// There are several stages where Webpack plugins can modify assets; this is the
						// last one, intended for "creating assets for the reporting purposes"
						stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
					},
					async (assets) => {
						if (importmap === undefined) {
							importmap = await generateImportMap(compilation);
						}
						if (importmap != null) {
							assets[importMapFileName] =
								new compiler.webpack.sources.OriginalSource(
									formatImportmap(),
									importMapFileName,
								);
						}
					},
				);

				// Integrate with html-webpack-plugin if it's being used, unless configured not to
				if (HtmlWebpackPlugin) {
					const hooks = HtmlWebpackPlugin.getCompilationHooks(compilation);
					hooks.beforeAssetTagGeneration.tap("glob-entry", (data) => {
						if (
							data.plugin.options &&
							data.plugin.options.scriptLoading !== "module"
						) {
							// force HtmlWebpackPlugin to use `<script type="module">` since we've already made Webpack emit modules
							logger?.warn(
								"Setting HtmlWebpackPlugin scriptLoading = true for native import support.",
							);
							data.plugin.options.scriptLoading = "module";
						}
						return data;
					});
					hooks.alterAssetTags.tapPromise("glob-entry", async (data) => {
						if (importmap === undefined) {
							importmap = await generateImportMap(compilation);
						}
						if (importmap != null) {
							// Manipulate the content
							data.assetTags.scripts.unshift({
								tagName: "script",
								attributes: { type: "importmap" },
								meta: { plugin: "glob-entry" },
								innerHTML: formatImportmap(),
								voidTag: false,
							});
						}
						return data;
					});
				}
			});
		},
	};
}
