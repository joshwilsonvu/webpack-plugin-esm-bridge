import type * as Webpack from "webpack";
import type * as Rspack from "@rspack/core";
import type { ImportMap, Options } from "./types.js";
import {
	formatAsset,
	formatEntrypoint,
	formatPath,
	loadPaths,
} from "./paths.js";

const PLUGIN_NAME = "glob-entry";

type WebpackEntries = Record<
	string,
	Omit<Rspack.EntryDescriptionNormalized, "filename" | "publicPath">
>;

// This strange use of generics allows the Webpack entrypoint to only need Webpack types, and same
// for Rspack. See dist/webpack.d.ts for proof.
export default function WebpackPluginGlobEntry<
	Pack extends typeof Webpack | typeof Rspack,
>(options: Options) {
	type Compiler = InstanceType<Pack["Compiler"]>;
	type Compilation = InstanceType<Pack["Compilation"]>;

	const patterns = options.patterns
		? typeof options.patterns === "string"
			? [options.patterns]
			: options.patterns
		: [];
	options.importMap ??= {};
	options.importMap.fileName ??= "importmap.json";
	options.importMap.prefix ??= "";
	options.importMap.prefix = options.importMap.prefix.replace(/\/$/, "");

	let _paths: Array<string> | null = null; // cache
	async function getFreshPaths(compiler: Compiler): Promise<Array<string>> {
		_paths = await loadPaths(patterns, {
			baseNameMatch: true,
			cwd: compiler.context,
			fs: (compiler.inputFileSystem ?? (await import("node:fs"))) as any,
			...options.globbyOptions,
		});
		return _paths;
	}
	async function getPaths(compiler: Compiler) {
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
			};
			return acc;
		}, {} as WebpackEntries);
	}

	async function generateImportMap(
		compilation: Compilation,
	): Promise<ImportMap | null> {
		if (options.importMap?.disabled) {
			return null;
		}

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
			const pathsSet = new Set(
				await getPaths(compilation.compiler as Compiler),
			);
			const importmap: ImportMap = { imports: {} };
			let entries = Object.entries(stats.entrypoints);
			if (options.importMap?.include !== "all") {
				entries = entries.filter(([entrypoint]) => pathsSet.has(entrypoint));
			}
			for (let [entrypoint, desc] of entries) {
				entrypoint = formatEntrypoint(entrypoint, options.importMap);

				const outputFiles = desc.assets?.filter(
					(asset) => !/\.(?:map|gz|br)$/.test(asset.name) && !("info" in asset),
				);
				if (outputFiles) {
					if (outputFiles.length > 1) {
						throw new Error(`Multiple assets found for entry ${entrypoint}`);
					}
					if (outputFiles.length !== 1) {
						throw new Error(`No assets found for entry ${entrypoint}`);
					}

					const [outputFile] = outputFiles;
					const resolvedAsset = formatAsset(
						outputFile.name,
						stats.publicPath ?? "/",
					);
					importmap.imports[entrypoint] = resolvedAsset;
					if (options.importMap?.integrity) {
						const source = compilation.getAsset(outputFile.name)?.source;
						if (source) {
							const hash = (await import("node:crypto")).createHash("sha384");
							source.updateHash(hash);
							const digest = hash.digest("base64");

							importmap.integrity ??= {};
							importmap.integrity[resolvedAsset] = `sha384-${digest}`;
						}
					}
				}
			}

			// allow user to manipulate content
			await options.importMap?.onCreate?.(importmap);

			return importmap;
		}
		return null;
	}

	return {
		apply(compiler: Compiler): void {
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
				let importmap: ImportMap | null | undefined;
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
							importmap = await generateImportMap(compilation as Compilation);
						}
						if (importmap != null) {
							assets[options.importMap!.fileName!] =
								new compiler.webpack.sources.OriginalSource(
									formatImportmap(),
									options.importMap!.fileName!,
								);
						}
					},
				);

				// Integrate with html-webpack-plugin if it's being used, unless configured not to
				if (HtmlWebpackPlugin) {
					const hooks = HtmlWebpackPlugin.getCompilationHooks(
						compilation as any,
					);
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
							importmap = await generateImportMap(compilation as Compilation);
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
