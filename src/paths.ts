import path from "node:path";
import type { Options as GlobbyOptions } from "globby";
import type { Options } from "./types.js";

function forward(p: string): string {
	const isWin = path.sep === "\\";
	if (isWin) {
		return p.replace(/\\/g, "/");
	}
	return p;
}

export function formatPath(file: string): string {
	return forward(file);
}

export function formatEntrypoint(
	entrypoint: string,
	options?: Pick<NonNullable<Options["importMap"]>, "prefix" | "trimExtension">,
): string {
	if (options?.prefix) {
		entrypoint = `${options.prefix}/${entrypoint}`;
	}
	if (options?.trimExtension) {
		entrypoint = entrypoint.replace(/\.[^/.]+$/, "");
	}
	return entrypoint;
}

export function formatAsset(assetPath: string, publicPath: string): string {
	if (URL.canParse(publicPath)) {
		return new URL(forward(assetPath), publicPath).href;
	}
	const sep = publicPath.endsWith("/") ? "" : "/";
	return `${publicPath}${sep}${forward(assetPath)}`;
}

export async function loadPaths(
	patterns: Array<string>,
	options?: GlobbyOptions,
): Promise<Array<string>> {
	if (patterns.length === 0) {
		return [];
	}
	const { globby } = await import("globby"); // import ESM from maybe CJS
	return globby(patterns, {
		onlyFiles: true,
		baseNameMatch: true,
		ignore: ["**/node_modules/**/*", ...(options?.ignore ?? [])],
		...options,
	});
}
