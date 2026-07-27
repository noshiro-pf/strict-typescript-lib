# Repository Guidelines

In addition to the common instructions above (vendored into `agents/common-rules.md` from the common-agent-config repository), project-specific rules are shown below.

## Project overview

`strict-typescript-lib` generates a **strict** rewrite of TypeScript's built-in
`lib.*.d.ts` declarations for every supported TypeScript minor (v5.0–v6.0), in
both a plain and a **branded-number** flavor, and distributes them as **GitHub
Release tarball assets** (fine-grained `strict-ts-lib-vX.Y-*` packages, one per
lib file, plus a per-version umbrella). Consumers alias them onto
`@typescript/lib-*` (see the root `README.md`).

## Layout

- `packages/scripts-common/` — the generator (private). `src/convert-dts/**`
  holds the per-lib-file transforms, `src/functions/**` the pipeline (codemod →
  lib files → packages), `src/commands/**` the entry points.
- `packages/vX.Y/` — one private harness project per TypeScript version.
  - `scripts/version-config.mts` — that version's config (TypeScript version,
    version ranges, lib name), imported by `scripts/_options.mts`. **Edit this**
    (not a JSON file) to change a version's settings.
  - `output/`, `output-branded/` — **generated** lib files and packages.
- `configs/` — shared tooling config. `docs/design.md` — the design doc.

## Essential Development Commands

This repo has no bundler build; the "build" is the generator. Key commands:

- `pnpm ws:gen` / `pnpm ws:gen:with-codemod-fixed` — regenerate every version's
  strict lib files and packages under `output/` and `output-branded/`.
- `pnpm agents:gen` — regenerate `AGENTS.md` from `agents/*.md`.
- `pnpm changeset:all <major|minor|patch> [--version=<range>]` — create a
  release changeset (targets the per-version `-source` packages).
- `pnpm run check:root:tooling` — type-check the generator, scripts, and configs
  (stock lib).
- `pnpm --filter strict-ts-lib-vX.Y-source run type-check` — per-version
  lib-check: run `tsc@X.Y` over the generated lib with `skipLibCheck: false`.
- `pnpm run lint` / `lint:fix`, `pnpm run fmt`, `pnpm run cspell`,
  `pnpm run md`, `pnpm run check-all` — validation and formatting.

## Generated / auto-managed files — do NOT edit directly

Hand-editing generated output is always wrong: the next generate run overwrites
it. Change the **source** and regenerate instead.

- **`packages/v*/output/**` and `packages/v*/output-branded/**`** (the strict
  lib `.d.ts` plus each package's `index.d.ts` / `package.json`) — edit the
  generator under `packages/scripts-common/src/` instead: `convert-dts/**` for
  the per-lib transforms, `functions/gen-packages.mts` for the `package.json`
  shape, the codemod, and `functions/codemod/rewrite-ts-type-forge-refs.mts`.
  Regenerate with `pnpm ws:gen` (or `ws:gen:with-codemod-fixed`).
- **`AGENTS.md`** — edit `agents/local-rules.md` (repo-specific — **this file**)
  and `agents/common-rules.md` (shared; vendored via `pnpm agents:sync`, so edit
  it upstream, not here). Regenerate with `pnpm agents:gen`.

When generated output needs to change, edit the generator, then validate a
representative version with its lib-check before regenerating everything:
`pnpm --filter strict-ts-lib-vX.Y-source run type-check` runs `tsc@X.Y` over the
generated lib with `skipLibCheck: false`.

`README.md` and `docs/**` are hand-written — edit them directly.
