import path from "node:path";
import { globby, type Options as GlobbyOptions } from "globby";

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

export function formatAsset(assetPath: string, publicPath: string): string {
	if (URL.canParse(publicPath)) {
		return new URL(forward(assetPath), publicPath).href;
	}
	const sep = publicPath.endsWith("/") ? "" : "/";
	return `${publicPath}${sep}${forward(assetPath)}`;
}

export function loadPaths(
	patterns: Array<string>,
	options?: GlobbyOptions,
): Promise<Array<string>> {
	if (patterns.length === 0) {
		return Promise.resolve([]);
	}
	return globby(patterns, { onlyFiles: true, unique: true, ...options });
}
