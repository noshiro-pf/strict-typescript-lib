# strict-typescript-lib

<!--
[![npm version](https://img.shields.io/npm/v/strict-typescript-lib.svg)](https://www.npmjs.com/package/strict-typescript-lib)
[![npm downloads](https://img.shields.io/npm/dm/strict-typescript-lib.svg)](https://www.npmjs.com/package/strict-typescript-lib)
[![License](https://img.shields.io/npm/l/strict-typescript-lib.svg)](./LICENSE)
 -->

## Usage

This project ships a **strict** rewrite of TypeScript's built-in library
declarations (`lib.es5.d.ts`, `lib.dom.d.ts`, …), one set per TypeScript minor
version.

Install the single package that matches **the exact TypeScript version you
use** — for TypeScript 5.9:

```sh
npm install -D strict-ts-lib-v5.9
```

That umbrella package depends on the strict `@typescript/lib-*` replacements for
every built-in library, so TypeScript's library-replacement mechanism (on by
default since TypeScript 4.5) loads the strict declarations in place of the
bundled ones — no other configuration required. A **branded-number** flavor is
published in parallel as `strict-ts-lib-v5.9-branded`.

> **pnpm users:** transitive dependencies are not hoisted to your project root
> by default, so add `public-hoist-pattern[]=@typescript/lib-*` to your `.npmrc`
> (or use the per-lib aliases below).

### Advanced: per-lib aliases

To pull in only some libraries, skip the umbrella and alias the fine-grained
`strict-ts-lib-vX.Y-*` packages onto `@typescript/lib-*` yourself:

```jsonc
// package.json
{
    "devDependencies": {
        "typescript": "5.9.3",
        // one entry per built-in lib you rely on:
        "@typescript/lib-es5": "npm:strict-ts-lib-v5.9-es5@^1",
        "@typescript/lib-dom": "npm:strict-ts-lib-v5.9-dom@^1",
    },
}
```

The alias target's version segment (`v5.9`) must match your TypeScript minor
version. The `@typescript/lib-<name>` key is the built-in lib name with dots
replaced by `-` (e.g. `lib.dom.iterable` → `@typescript/lib-dom-iterable`).

### TypeScript version support

- **`>=5.0 <6.0`** — Supported. `@typescript/lib-*` aliases are resolved
  automatically; use the `strict-ts-lib-vX.Y-*` matching your minor.
- **`>=6.0`** — Likely supported, but you may need to set
  `"libReplacement": true` in your `tsconfig.json` `compilerOptions`.
- **`<5.0`** — Not supported yet.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
