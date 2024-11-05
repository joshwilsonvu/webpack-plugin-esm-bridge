import type { Options as GlobbyOptions } from "globby";

export interface ImportMap {
	imports: Record<string, string>;
	scopes?: Record<string, Record<string, string>>;
	integrity?: Record<string, string>;
}

export interface Options {
	patterns?: string | Array<string>;

	importMap?: {
		include?: "globbed" | "all" | null;
		fileName?: string | null;
		prefix?: string | null;
		trimExtension?: boolean | null;
		integrity?: boolean;
		onCreate?: ((importMap: ImportMap) => void | Promise<void>) | null;
		disabled?: boolean;
	};

	globbyOptions?: GlobbyOptions | null;
	noHtmlWebpackPlugin?: boolean;
}
