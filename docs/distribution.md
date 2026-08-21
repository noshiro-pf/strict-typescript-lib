# Distribution (one bundle per version and flavor)

This repository distributes its generated declarations as **one package per
TypeScript version and flavor** — every built-in library lives inside it, under
`libs/` — through two channels: the **npm registry** and **GitHub Release
tarball assets**. Both carry the same tarball, packed by the same code.

## Why one package

It used to be one package per lib file (~107 per flavor, ~214 per version),
plus a per-version umbrella whose dependencies were those packages' tarball
URLs. The split existed so that a package manager would resolve the libs
**transitively**: install the umbrella and every `@typescript/lib-*` came with
it, with no configuration on the consumer's side. That worked while the
packages came from a registry.

Two things ended it.

- **npm could not take the split.** Publishing this many brand-new package
  names trips npm's anti-abuse / rate limits (HTTP 429), and a change in the
  shared generator fans out to every series — ~12 series x 2 flavors x ~107
  packages ≈ 2,400 publishes. Even one series' 214 was too many. Bundled, the
  same regeneration is 24 publishes, which the registry accepts: every series
  is now published (v5.0 … v7.0, both flavors).
- **URL sub-dependencies are refused.** Once the packages moved to release
  assets, the umbrella's dependencies became URLs, and pnpm blocks a URL that
  appears as a _sub_-dependency (`ERR_PNPM_EXOTIC_SUBDEP`). Lifting that needs
  `blockExoticSubdeps: false` **and** `publicHoistPattern`, because a
  transitive dependency never reaches the root `node_modules` where
  `libReplacement` looks. So the split's one benefit — no configuration — was
  already gone, and only its cost remained.

A bundle removes both. The consumer declares **one direct** URL dependency,
which every package manager accepts, and `paths` points TypeScript at `libs/*`.

It also removes dead weight that was easy to miss: of the ~107 packages per
flavor, only the ~15 group-level ones were ever resolved. TypeScript's
`getLibraryNameFromLibFileName` asks for
`@typescript/lib-es2015/symbol-wellknown` — the group is the package, the rest
is a **subpath** — so the separately published
`strict-ts-lib-vX.Y-es2015-symbol-wellknown` was never looked up by anyone.
Those declarations only ever worked because they also sit nested inside the
group package. The bundle keeps that nesting and drops the copies.

## What is distributed

Two packages per TypeScript version:

- `strict-ts-lib-vX.Y` — the plain flavor.
- `strict-ts-lib-vX.Y-branded` — the branded-number flavor.

Each holds `libs/<group>[/<rest>]/index.d.ts` for every built-in library,
mirroring `output/packages` (respectively `output-branded/packages`) exactly,
and declares `ts-type-forge` as its own dependency so every one of those files
can resolve it.

The private workspace members (`strict-ts-lib-vX.Y-source` and
`scripts-common`) are never distributed.

## Release layout

One GitHub Release per TypeScript version, tagged **`dist-vX.Y-<version>`**
(flavor-independent — branded and non-branded share the release), with **two**
assets: `strict-ts-lib-vX.Y-<version>.tgz` and
`strict-ts-lib-vX.Y-branded-<version>.tgz`.

`gen-packages.mts` bakes the matching install URL into each bundle's
`README.md`, and `dist-github-release.mts` derives the same tag from the
directory name and the bundle's version, so the two cannot drift.

## Cutting a release

Releases are automated through Changesets + `.github/workflows/release.yml`:

1. **Create a changeset** — `pnpm changeset:all <major|minor|patch> [--version=<range>]`.
   It bumps the per-version `strict-ts-lib-vX.Y-source` packages (the version
   carriers). Commit it.
2. **Version PR** — on push to `main`, the Changesets action runs
   `changeset:version-packages` (`changeset version` → `ws:gen:packages` →
   install), opening a "Version Packages" PR that bumps `-source` and
   regenerates the manifests with the new version.
3. **Release** — when that PR is **merged**, the Changesets action's publish
   step runs `release:publish` (= `ws:gen:packages && dist:github-release`),
   which stages each bundle, packs it, and uploads the two tarballs to the
   GitHub Release `dist-vX.Y-<version>`.

To release **manually** (or one version at a time):

```sh
pnpm changeset version && pnpm ws:gen:packages   # bump + propagate, then commit
pnpm dist:github-release [--version=5.9] [--dry-run] [--force]
```

### Staging

The bundles' `libs/` are **not** kept in the working tree — they would double
the ~6,900 tracked generated files for no reason. `pack-bundle.mts` assembles
them into a temp directory at pack time from `output(-branded)/packages`,
keeping the relative layout intact, and packs that.

Keeping the layout is load-bearing. `@typescript/lib-*` → `libs/*` maps
`es2015/symbol-wellknown` to `libs/es2015/symbol-wellknown`; flattening it to
`libs/es2015-symbol-wellknown` resolves for the ~15 group libs and silently
leaves every sub-lib on the stock declarations. Measured with
`--traceResolution` on TypeScript 7.0.2: nested resolves 88 of 88 lookups,
flattened 15 of 88 — with no error either way.

### Uploads are incremental (GitHub API rate limits)

The publish step runs on **every** push to `main` (Changesets runs `publish`
whenever no changesets are pending), so it must be a cheap no-op when nothing
changed. It reads each release once (`gh release view --json body,assets`) and
uploads only the assets that are **missing or whose size differs**; the notes
are rewritten only when they actually changed. `npm pack` output is
byte-reproducible, so an equal size means the published asset is the same
tarball.

This mattered more when a version had ~214 assets: re-uploading everything with
`--clobber` cost two REST calls per asset — roughly 4,000 across all versions,
which exceeded the release App installation's hourly REST quota and failed the
job partway through with `HTTP 403: API rate limit exceeded`. With two assets
per version the machinery is cheap either way; it stays because a no-op re-run
should stay a no-op.

Transient failures (rate limits, 5xx, dropped connections) are retried with
exponential backoff. Use `--force` to re-upload every asset and rewrite the
notes regardless (e.g. if a published asset is known to be corrupt).

## Publishing to npm

`release.yml` publishes the bundles with `dist:npm-publish --publish`, in a step
of its own **after** the GitHub Release is created — the release is the channel
existing consumers install from, so nothing npm does can hold it back.

Authentication is **trusted publishing**: OIDC against the trusted publisher
configured per package on npm, so the workflow carries no npm token and asks for
`id-token: write` instead. The npm bundled with Node 22 predates the trust
tooling (`npm trust` documents `npm@11.15.0` as its floor), so the step installs
a current npm first.

The step is a **no-op unless something new was released**: a version already on
the registry is skipped rather than re-published, because npm refuses to
overwrite one (`EPUBLISHCONFLICT`). That matters because the Changesets action
runs its publish step on every push to `main` where no changesets are pending.

Run by hand with
`pnpm dist:npm-publish [--version=7.0] [--publish] [--tag=<dist-tag>] [--otp=<code>] [--pack-only]`.
It is a dry run unless `--publish` is passed, and it packs exactly what
`dist:github-release` uploads. A **new** TypeScript series still needs one
manual publish and its own trusted-publisher configuration before CI can take
over — see [first-release.md](./first-release.md), which also records what would
remove that step for good.

## Consuming

See the root `README.md`. In short: install the tarball URL, then map the libs
in `tsconfig.json`.

```jsonc
{
    "compilerOptions": {
        "libReplacement": true, // TypeScript 6.0 and later
        "paths": {
            "@typescript/lib-*": ["./node_modules/strict-ts-lib-v5.9/libs/*"],
        },
    },
}
```

`paths` is replaced, not merged, by a config that `extends` another, and a
missing entry disables the replacement with no diagnostic at all. Verify with a
declaration only the strict library rejects (`parseInt('10', 1)`), or with
`tsc --traceResolution`.

## Notes

- **A registry dependency takes semver ranges; a URL does not.** Consumers on
  npm can write `^0.2.0` and let their package manager move it; consumers on a
  release URL pin an exact release and bump by pointing at a newer tag.
- **`ts-type-forge`** is resolved from the public npm registry, as it always
  was, and is declared once by each bundle on behalf of every declaration
  inside it.
