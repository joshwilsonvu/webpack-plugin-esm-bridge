import type { Options as GlobbyOptions } from "globby";

export interface Options {
	patterns?: string | Array<string>;

	importMapFileName?: string | null;
	globbyOptions?: GlobbyOptions | null;
}
