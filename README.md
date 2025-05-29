# webpack-plugin-esm-bridge

Readable, granular, and performant JS loading for HTML.

[![NPM version](https://img.shields.io/npm/v/webpack-plugin-esm-bridge?color=a1b858&label=)](https://www.npmjs.com/package/webpack-plugin-esm-bridge)

## What is this?

This plugin "bridges" plain HTML or compile-to-HTML templates (even non-JS, like Rails) with your
bundler, so that your markup can use native ESM imports to load your bundled JS instead of dealing
with manifests, helper functions, reverse proxies, etc.

By loading only the JS you really need for each page, you'll avoid ending up with a single multi-MB
JS bundle. And when loading JS is as simple as renaming a file and adding an `import`, you can use TypeScript, npm dependencies, etc. as easily as an inline script.

```ts
// my-module.entry.ts - bundled
import { whatever } from "a-dependency";

export function doSomething(value: string) { /* ... */ }
```

```html
<script type="module">
  // runs in the browser - not bundled
  import { doSomething } from "my-module.entry.ts";

  doSomething({{ templatedValue }});
</script>
```

or,

```html
<script type="module" src="my-module.entry.ts"></script>
```

## How does it work?

It adds entry points based on a glob pattern like `*.entry.*`, and generates an [import
map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) that maps the
source file to the generated JS bundle. Creating entry points as easily as renaming files allows you
to break up your JS into smaller bundles and only load what's needed for a particular page or
partial. The import map keeps your templates clean and maintainable.

> [!WARNING]
> This plugin enables Webpack/Rspack's [experimental support for generating
> ESM](https://webpack.js.org/configuration/experiments/#experimentsoutputmodule) if not already
> enabled. Track Webpack's progress [here](https://github.com/webpack/webpack/issues/2933).

## When should I use this?

When you have a setup that serves plain HTML or HTML templates, and:

 - you have a substantial amount of JS, or
 - you want to use JS tooling—transpilation, minification, TypeScript, or [asset modules](https://webpack.js.org/guides/asset-modules)

If you're using a JS framework, you don't need this.

<details>
<summary>Comparison with `importmap-rails`</summary>

[`importmap-rails`](https://github.com/rails/importmap-rails) also uses import maps to serve JS, but
it doesn't perform any bundling. This is fine for small projects, but even with module preloading
and HTTP/2, there is still some overhead. Minification and tree-shaking are also necessary for
larger production applications. This plugin aims to make it as easy as possible to get the benefits of bundling and
modern JS tools without complicating development.

</details>

<details>
<summary>Preloading</summary>

Because each entry point is bundled, preloading modules is usually not necessary—bundles are loaded as the HTML is parsed, and bundles typically don't need to load more JS that would cause a waterfall.

If you want to prefetch an entry point anyway (i.e. for navigation that doesn't involve a full page load), you can
add a `modulepreload` link as appropriate, or use a dynamic import. These work with import maps.

```html
<link rel="modulepreload" href="some-module.entry.js">
```

```js
import('some-module.entry.js')
```

</details>

## Installation

You'll need to configure a Webpack or Rspack setup first. You don't need to connect the bundler
output to your backend.

```bash
npm i @joshwilsonvu/webpack-plugin-esm-bridge
```

```ts
// webpack.config.js
const EsmBridge = require('webpack-plugin-esm-bridge');

module.exports = {
  entry: {}, // to disable default entry
  // ...
  plugins: [
    EsmBridge({
      patterns: '*.entry.*',
      // other options
    }),
  ],
}
```

<details>
<summary>Rspack</summary>

```ts
// webpack.config.js ("type": "module" in package.json)
import EsmBridge from 'webpack-plugin-esm-bridge/rspack';

export default {
  entry: {}, // to disable default entry
  // ...
  plugins: [
    EsmBridge({
      patterns: '*.entry.*',
      // other options
    }),
  ],
}
```
</details>

Then, you'll need to ensure that the generated import map is included at the top of your HTML
(before any ESM) once per page load. By default, it's `"importmap.json"` in the bundler's output
directory, but this can be changed with the  `importMap.fileName` option.

Finally, you'll need to configure the bundler's `output.publicPath` to something other than `"auto"`
for import map generation to work.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `patterns` | `string \| Array<string>` | | **Required.** The [glob](https://www.npmjs.com/package/globby) pattern(s) to use to find entry points (within the configured `context`), ex. `*.entry.*`. A bundle will be created for each entry point, and these files can be referenced from native imports. |
| `importMap.include` | `'globbed' \| 'all'` | `'globbed'` | `'globbed'` only includes files matching `'patterns'` in the import map; `'all'` includes manually configured `entry` files as well. |
| `importMap.fileName` | `string` | `'importmap.json'` | The name of the generated import map that must be included at the top of your HTML. |
| `importMap.prefix` | `string` | `''` | A prefix to be prepended to each mapped module specifier. Ex. `'~'` produces imports like `"~/my-module.entry.ts"` |
| `importMap.trimExtension` | `boolean` | `false` | Whether to remove the extension from each mapped module specifier. Ex. `"my-module.entry.ts"` → `"my-module.entry"` |
| `importMap.integrity` | `boolean` | `false` | Whether to add [subresource integrity](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap#integrity) to the import map. May increase compilation time and import map size. |
| `importMap.onCreate` | `(importMap: ImportMap) => void \| Promise<void>` | | A function to arbitrarily modify the generated import map. Can be used to merge in other entries not controlled by this plugin. |
| `importMap.disabled` | `boolean` | `false` | Disables generation of the import map altogether. The plugin will only add entry points matching `'patterns'`. |
| `globbyOptions` | `object` | | Additional options to pass to [globby](https://www.npmjs.com/package/globby). Can be used to override the `cwd` to search in, or respect `.gitignore` with `gitignore: true`, among other things. |
| `noHtmlWebpackPlugin` | `boolean` | `false` | Disables the built-in integration with [`html-webpack-plugin`](https://www.npmjs.com/package/html-webpack-plugin). By default, the import map will be automatically inlined into the HTML template for you. |