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
library-replacement mechanism loads the strict declarations in place of the
bundled ones. On TypeScript 5.x that needs no further configuration; from
TypeScript 6.0 it also needs `"libReplacement": true` (see
[TypeScript version support](#typescript-version-support)), and pnpm needs a
setting or two of its own (see below). A **branded-number** flavor is published
alongside as `strict-ts-lib-vX.Y-branded`.

### npm / yarn — install the umbrella (one line)

```sh
npm install -D https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v5.9-<version>/strict-ts-lib-v5.9-<version>.tgz
```

The umbrella depends on all the per-lib tarballs, so this single install wires
up every `@typescript/lib-*`.

### pnpm — two ways in

Either route ends with the same `@typescript/lib-*` packages in your root
`node_modules`, which is the only place TypeScript looks for them. Pick by
whether you would rather configure pnpm once or carry the entries in your
`package.json`.

#### Option A — the umbrella plus two pnpm settings (one dependency)

```yaml
# pnpm-workspace.yaml
publicHoistPattern:
    - '@typescript/lib-*'

blockExoticSubdeps: false # pnpm 11 and later only
```

```jsonc
// package.json
{
    "devDependencies": {
        "typescript": "7.0.2",
        "strict-ts-lib-v7.0": "https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v7.0-<version>/strict-ts-lib-v7.0-<version>.tgz",
    },
}
```

Both settings are load-bearing, for different reasons:

- **`publicHoistPattern`** — pnpm keeps a transitive dependency under
  `node_modules/.pnpm/` and links only direct dependencies into the root
  `node_modules`. TypeScript resolves `@typescript/lib-*` by walking
  `node_modules` up from the directory it was invoked in and nowhere else, so
  without hoisting the packages are installed but never found, and the
  replacement silently does not happen. Required on every pnpm version.
- **`blockExoticSubdeps`** — pnpm 11 refuses URL dependencies that arrive as
  sub-dependencies (`ERR_PNPM_EXOTIC_SUBDEP`), and the umbrella's dependencies
  are all release URLs. pnpm 10 and earlier allow them, so this line is only
  needed from pnpm 11.

Two things worth knowing before copying this:

- **pnpm 11 reads these from `pnpm-workspace.yaml` only.** The same settings in
  `.npmrc` (`public-hoist-pattern[]=@typescript/lib-*`,
  `block-exotic-subdeps=false`) are ignored there, and the install fails with no
  hint as to why. On pnpm 10 either file works.
- **`blockExoticSubdeps` is a repository-wide boolean with no allow list**, so
  turning it off lifts the guard for every dependency, not just this one. Where
  that matters — dependency-update pull requests that merge automatically, say —
  a check over `pnpm-lock.yaml` asserting that every `tarball:` points at this
  repository's releases puts the guarantee back, and covers direct dependencies
  as well.

#### Option B — the per-lib entries directly (no pnpm settings)

Top-level URL dependencies are allowed on every pnpm version and are linked into
the root `node_modules` on their own, so declaring each lib yourself needs no
configuration. Each release's notes contain a ready-to-paste block; it looks
like:

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

The cost is that an upgrade rewrites all of those lines rather than one, and a
partial rewrite leaves two releases' declarations mixed together.

The `@typescript/lib-<name>` key is the built-in lib name with dots replaced by
`-` (e.g. `lib.dom.iterable` → `@typescript/lib-dom-iterable`), and the version
segment (`v5.9`) must match your TypeScript minor version.

### TypeScript version support

- **`>=5.0 <=7.0`** — Supported (v5.0–v7.0 published). `@typescript/lib-*`
  aliases are resolved automatically; use the `strict-ts-lib-vX.Y-*` matching
  your minor. On TypeScript 6.0 and later, set `"libReplacement": true` in your
  `tsconfig.json` `compilerOptions` — it no longer defaults to on, and the
  aliases are ignored without it.
- **`<5.0`** — Not supported.
- **`>7.0`** — No matching version yet; use the closest published minor.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
