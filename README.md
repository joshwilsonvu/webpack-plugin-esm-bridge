# webpack-plugin-esm-bridge

[![NPM version](https://img.shields.io/npm/v/webpack-plugin-esm-bridge?color=a1b858&label=)](https://www.npmjs.com/package/webpack-plugin-esm-bridge)

## What is this?

This plugin "bridges" plain HTML or compile-to-HTML templates (even non-JS, like Rails) with the
bundler's module graph, so that your markup can use native ESM imports to load your bundled JS,
instead of dealing with manifests, helper functions, reverse proxies, etc.

It adds entry points based on a glob pattern like `*.entry.*`, and generates an [import
map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) that maps the
source file to the generated JS bundle. Creating entry points based on files allows you to break up
your JS into smaller bundles and only load what's needed for a particular page or partial, while the
import map keeps your templates clean and maintainable.

```ts
// my-module.entry.ts
export function doSomething(value: string) { /* ... */ }
```

```html
<script type="module">
  import { doSomething } from "my-module.entry.ts";

  doSomething({{ templatedValue }});
</script>
```

## Install

```bash
npm i webpack-plugin-esm-bridge
```

```ts
// webpack.config.js
const EsmBridge = require('webpack-plugin-esm-bridge');

module.exports = {
  entry: {},
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
  /* ... */
  plugins: [
    EsmBridge({
      patterns: '*.entry.*',
    }),
  ],
}
```
</details>