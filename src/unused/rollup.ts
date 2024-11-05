/** Focusing on webpack/rspack for now, this code is incomplete and unused. */
// @ts-nocheck

import path from "node:path";
import type * as Rollup from "rollup";
import type * as Rolldown from "rolldown";
import { globby } from "globby";

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

function loadPaths(
	patterns: Array<string>,
	base = cwd,
): Promise<Array<string>> {
	if (patterns.length === 0) {
		return Promise.resolve([]);
	}
	return globby(patterns, { onlyFiles: true, cwd: base, unique: true });
}


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
        for (const p of (await getFreshPaths())) {
          input[formatPath(p)] ??= p;
        }
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
          `webpack-plugin-esm-bridge requires output.format: 'module'. Either remove output.format or set it to 'module'.`,
        );
      }
    },
  } satisfies Partial<Rollup.Plugin> | Partial<Rolldown.Plugin>;
})();

export default rollup;