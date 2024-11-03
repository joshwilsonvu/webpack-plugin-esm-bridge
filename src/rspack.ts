import Plugin from "./plugin.js";
import type * as Rspack from "@rspack/core";

export default Plugin<typeof Rspack>;

export type * from "./types.js";
