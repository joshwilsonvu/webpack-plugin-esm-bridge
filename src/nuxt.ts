import { addVitePlugin, addWebpackPlugin, defineNuxtModule } from "@nuxt/kit";
import vite from "./vite.js";
import webpack from "./webpack.js";
import type { Options } from "./types.js";
import "@nuxt/schema";

export interface ModuleOptions extends Options {}

export default defineNuxtModule<ModuleOptions>({
	meta: {
		name: "nuxt-unplugin-glob-entry",
		configKey: "unpluginStarter",
	},
	defaults: {
		// ...default options
	},
	setup(options, _nuxt) {
		addVitePlugin(() => vite(options));
		addWebpackPlugin(() => webpack(options));

		// ...
	},
});
