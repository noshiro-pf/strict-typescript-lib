# npm Publishing

This repository publishes its generated packages to the **public npm registry**
(`https://registry.npmjs.org/`). Everything is unscoped and public.

## What gets published

- Fine-grained per-lib packages — one per lib file, per TypeScript version, in a
  plain and a branded-number flavor: `strict-ts-lib-vX.Y-<lib>` and
  `strict-ts-lib-vX.Y-branded-<lib>`.
- One umbrella package per version/flavor: `strict-ts-lib-vX.Y` and
  `strict-ts-lib-vX.Y-branded` (installing it pulls in all `@typescript/lib-*`
  replacements — see the root `README.md`).

All of the above are `private: false`. The private workspace members
(`strict-ts-lib-vX.Y-source` / `-output` / `-output-branded`, and
`scripts-common`) are never published.

## Authentication: npm automation token

Publishing spans ~1700 packages, so it must not prompt for 2FA. Use an npm
**automation token** (npmjs.com → Access Tokens → Generate New Token →
Automation); automation tokens are exempt from the 2FA prompt on publish.

1. Create the token from an account with publish rights to these package names.
2. Add it as the repository secret **`NPM_TOKEN`**
   (**Settings → Secrets and variables → Actions**).

`.github/workflows/release.yml` sets `registry-url: https://registry.npmjs.org/`
and exposes `NPM_TOKEN` as `NODE_AUTH_TOKEN`, which `npm publish` reads via the
`.npmrc` that `actions/setup-node` writes.

The GitHub App (see [`github-app-setup.md`](./github-app-setup.md)) is only for
opening the Changesets release PR — it is unrelated to npm publishing.

## Release flow

1. Create a changeset for the versions to release:
   `pnpm changeset:all <major|minor|patch> [--version=<range>]`. It targets the
   per-version `strict-ts-lib-vX.Y-source` packages (the version carriers).
2. On merge to `main`, Changesets opens a "Version Packages" PR via
   `changeset:version-packages`: `changeset version` bumps `-source`, then
   `ws:gen:packages` propagates the new version onto every generated package,
   and the lockfile is refreshed.
3. Merging that PR runs `changeset:publish`
   (`ws:gen:packages && tsx ./scripts/cmd/publish-packages.mts`).

### `publish-packages.mts`

`changeset publish` does not scale to ~1700 packages under 2FA and stumbles on
the very first publish. `scripts/cmd/publish-packages.mts` instead:

- discovers every publishable package under `packages/*/output{,-branded}/**`,
- **skips any whose exact `name@version` is already on the registry**, so it is
  safe to re-run and covers both the first release and later additions (e.g. a
  new `es2027` lib file) with the same command, and
- publishes the rest with bounded concurrency and retries.

Run it directly:

```sh
pnpm publish:packages --dry-run        # list what would be published
pnpm publish:packages                  # publish (needs NPM_TOKEN or `npm login`)
pnpm publish:packages --concurrency=16
pnpm publish:packages --otp=123456     # manual run under 2FA without a token
```

`NPM_REGISTRY` overrides the target registry (default
`https://registry.npmjs.org/`).

## Consuming published packages

See the root `README.md`: `npm install -D strict-ts-lib-vX.Y` matching your
TypeScript version, or alias individual `@typescript/lib-*` entries.

## Troubleshooting

- **`Received 404 for npm info <pkg>` on first publish** — expected: the package
  does not exist yet. The publish script treats a 404 as "not published" and
  publishes it.
- **2FA / OTP prompt in CI** — you are not using an automation token. Create one
  and set `NPM_TOKEN` (see above).
- **`E403` / `ENEEDAUTH`** — `NPM_TOKEN` is missing, expired, or lacks publish
  rights for the package name.

### Debugging commands

```sh
npm config get registry
npm whoami --registry=https://registry.npmjs.org/
```
