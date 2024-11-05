import Plugin from "./plugin.js";
import type * as Webpack from "webpack";

export default Plugin<typeof Webpack>;

export type * from "./types.js";
