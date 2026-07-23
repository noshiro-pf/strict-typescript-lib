# Distribution (GitHub Release tarballs)

This repository distributes its generated packages as **GitHub Release tarball
assets**, not via the npm registry. Publishing ~1700 brand-new package names to
npm repeatedly trips its anti-abuse / rate limits (HTTP 429), so instead each
release attaches the packed `.tgz` files to a GitHub Release and consumers
install them by URL — no npm account, no auth, no rate limits.

## What is distributed

- Fine-grained per-lib packages — one per lib file, per TypeScript version, in a
  plain and a branded-number flavor: `strict-ts-lib-vX.Y-<lib>` and
  `strict-ts-lib-vX.Y-branded-<lib>`.
- One umbrella package per version/flavor: `strict-ts-lib-vX.Y` and
  `strict-ts-lib-vX.Y-branded`. Its dependencies are the `@typescript/lib-*`
  tarball URLs, so installing it alone pulls in every strict lib (see the root
  `README.md`).

The private workspace members (`strict-ts-lib-vX.Y-source` / `-output` /
`-output-branded`, and `scripts-common`) are never distributed.

## Release layout

One GitHub Release per TypeScript version, tagged **`dist-vX.Y-<version>`**
(flavor-independent — branded and non-branded share the release). Its assets are
all of that version's `.tgz` files, e.g. `strict-ts-lib-v5.9-es5-1.0.0.tgz`.

`gen-packages.mts` bakes the matching
`https://github.com/<owner>/<repo>/releases/download/<tag>/<pkg>-<version>.tgz`
URLs into each umbrella's dependencies, so the umbrella and the release always
agree on the tag/filenames.

## Cutting a release

Releases are automated through Changesets + `.github/workflows/release.yml`:

1. **Create a changeset** — `pnpm changeset:all <major|minor|patch> [--version=<range>]`.
   It bumps the per-version `strict-ts-lib-vX.Y-source` packages (the version
   carriers). Commit it.
2. **Version PR** — on push to `main`, the Changesets action runs
   `changeset:version-packages` (`changeset version` → `ws:gen:packages` →
   install), opening a "Version Packages" PR that bumps `-source` and
   regenerates every package (umbrella URLs get the new version/tag).
3. **Release** — when that PR is **merged**, the Changesets action's publish
   step runs `release:publish` (= `ws:gen:packages && dist:github-release`),
   which packs every publishable package and uploads the tarballs to the GitHub
   Release `dist-vX.Y-<version>`. This is the point at which the tarballs become
   downloadable.

`dist:github-release` reads the release tag from each umbrella's baked-in URLs,
`npm pack`s all packages into a temp dir, and `gh release create`/`upload
--clobber`s the tarballs (using the workflow's `GH_TOKEN`; run locally it needs
an authenticated `gh`). Re-running is safe (assets are clobbered).

To release **manually** (or for a large first rollout, one version at a time):

```sh
pnpm changeset version && pnpm ws:gen:packages   # bump + propagate, then commit
pnpm dist:github-release [--version=5.9] [--dry-run]
```

There is no npm rate limit to worry about; `--version` just keeps each step
small and reviewable.

## Consuming

See the root `README.md`: install the umbrella tarball URL
(`npm install -D https://.../dist-vX.Y-<version>/strict-ts-lib-vX.Y-<version>.tgz`),
or point individual `@typescript/lib-*` entries at their tarball URLs. A tarball
dependency installs under its dependency **key**, so
`"@typescript/lib-es5": "https://.../strict-ts-lib-v5.9-es5-....tgz"` lands at
`node_modules/@typescript/lib-es5` and TypeScript's `libReplacement` picks it up
(verified on both npm and pnpm).

## Notes

- **pnpm consumers** may need `public-hoist-pattern[]=@typescript/lib-*` in
  `.npmrc` so the umbrella's transitive libs resolve at the project root (or use
  the per-lib entries).
- **Versioning has no semver ranges** — tarball URLs pin an exact release. Bump
  by pointing at a newer tag.
- **`ts-type-forge`** is still resolved from the public npm registry (it is a
  normal published dependency of each package); only this project's own packages
  are distributed via GitHub Releases.
- This project's packages are **not** published to any npm registry — there is
  no `npm publish` step.
