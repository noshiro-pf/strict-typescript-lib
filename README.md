# strict-typescript-lib

<!--
[![npm version](https://img.shields.io/npm/v/strict-typescript-lib.svg)](https://www.npmjs.com/package/strict-typescript-lib)
[![npm downloads](https://img.shields.io/npm/dm/strict-typescript-lib.svg)](https://www.npmjs.com/package/strict-typescript-lib)
[![License](https://img.shields.io/npm/l/strict-typescript-lib.svg)](./LICENSE)
 -->

## Usage

This project ships a **strict** rewrite of TypeScript's built-in library
declarations (`lib.es5.d.ts`, `lib.dom.d.ts`, …), one set per TypeScript minor
version, distributed as **GitHub Release tarballs** — not the npm registry, so
there is no registry account or authentication involved.

Pick the release matching **the exact TypeScript version you use** from the
[Releases](https://github.com/noshiro-pf/strict-typescript-lib/releases) page
(tags look like `dist-v5.9-1.0.0`). Installing pulls in the strict
`@typescript/lib-*` replacements for every built-in library, so TypeScript's
library-replacement mechanism (on by default since TypeScript 4.5) loads the
strict declarations in place of the bundled ones — no other configuration
required. A **branded-number** flavor is published alongside as
`strict-ts-lib-vX.Y-branded`.

### npm / yarn — install the umbrella (one line)

```sh
npm install -D https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v5.9-<version>/strict-ts-lib-v5.9-<version>.tgz
```

The umbrella depends on all the per-lib tarballs, so this single install wires
up every `@typescript/lib-*`.

### pnpm — add the per-lib entries directly

pnpm blocks URL dependencies that appear as **sub-dependencies**
(`blockExoticSubdeps`), so installing the umbrella fails with
`ERR_PNPM_EXOTIC_SUBDEP`. Instead, add the per-lib tarball URLs **directly** to
your `devDependencies` (top-level URL deps are allowed, and need no extra
config). Each release's notes contain a ready-to-paste block; it looks like:

```jsonc
// package.json
{
    "devDependencies": {
        "typescript": "5.9.3",
        "@typescript/lib-es5": "https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v5.9-<version>/strict-ts-lib-v5.9-es5-<version>.tgz",
        "@typescript/lib-dom": "https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v5.9-<version>/strict-ts-lib-v5.9-dom-<version>.tgz",
        // …one entry per lib (full block on the release page)
    },
}
```

(Alternatively, set `block-exotic-subdeps=false` in your `.npmrc` and add
`public-hoist-pattern[]=@typescript/lib-*`, then install the umbrella as above.)

The `@typescript/lib-<name>` key is the built-in lib name with dots replaced by
`-` (e.g. `lib.dom.iterable` → `@typescript/lib-dom-iterable`), and the version
segment (`v5.9`) must match your TypeScript minor version.

### TypeScript version support

- **`>=5.0 <6.0`** — Supported. `@typescript/lib-*` aliases are resolved
  automatically; use the `strict-ts-lib-vX.Y-*` matching your minor.
- **`>=6.0`** — Likely supported, but you may need to set
  `"libReplacement": true` in your `tsconfig.json` `compilerOptions`.
- **`<5.0`** — Not supported yet.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
