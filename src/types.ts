import type { Options as GlobbyOptions } from "globby";

export interface Options {
	patterns?: string | Array<string>;

	importMapFileName?: string | null;
  importMapPrefix?: string;
	globbyOptions?: GlobbyOptions | null;
}
