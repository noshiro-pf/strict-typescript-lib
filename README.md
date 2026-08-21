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
(tags look like `dist-v5.9-1.0.0`). Every built-in library ships inside **one
package**, so one dependency and one `paths` entry is the whole setup, on any
package manager. A **branded-number** flavor is published alongside as
`strict-ts-lib-vX.Y-branded`.

### 1. Install the package

```sh
npm install -D https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v5.9-<version>/strict-ts-lib-v5.9-<version>.tgz
```

`pnpm add -D <url>` and `yarn add -D <url>` work the same way, and need no
package-manager configuration: this is a **direct** URL dependency, which every
package manager accepts. (pnpm rejects URL dependencies only when a _dependency
of a dependency_ uses one — which is what an earlier layout, one package per
lib behind an umbrella, ran into.)

### 2. Point TypeScript at the libs

The libraries live under `libs/` inside that package, named the way TypeScript
asks for them, so one wildcard covers all of them:

```jsonc
// tsconfig.json
{
    "compilerOptions": {
        "libReplacement": true, // TypeScript 6.0 and later; see below
        "paths": {
            "@typescript/lib-*": ["./node_modules/strict-ts-lib-v5.9/libs/*"],
        },
    },
}
```

Two things to watch, because both fail **silently** — the replacement simply
does not happen, with no error and no warning:

- **`paths` is replaced, not merged, by a config that `extends` another.** A
  package whose own `tsconfig.json` sets `paths` for anything else needs this
  entry repeated there; putting it only in the shared base config is not
  enough.
- **The path is relative to the config that contains it.** From a package in a
  monorepo that is usually `../../node_modules/strict-ts-lib-v5.9/libs/*`.

To confirm it took effect, compile something that only the strict library
rejects:

```sh
echo "export const n = parseInt('10', 1);" > probe.ts
npx tsc --noEmit probe.ts   # strict lib: radix 1 is an error; stock lib: no error
```

`tsc --traceResolution` is the fuller check — every `@typescript/lib-*` lookup
it prints should end in `was successfully resolved`.

### TypeScript version support

- **`>=5.0 <=7.0`** — Supported (v5.0–v7.0 published). Use the
  `strict-ts-lib-vX.Y` matching your minor; the package's `peerDependencies`
  pins the range it was generated for. On TypeScript 6.0 and later, set
  `"libReplacement": true` in your `tsconfig.json` `compilerOptions` — it no
  longer defaults to on, and the `paths` entry above does nothing without it.
- **`<5.0`** — Not supported.
- **`>7.0`** — No matching version yet; use the closest published minor.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
