#!/usr/bin/env tsx

/**
 * Publishes the generated packages as **GitHub Release tarball assets** instead
 * of to the npm registry (which rate-limits / flags bulk publishing of ~1700
 * new package names). For each TypeScript version it:
 *
 * 1. discovers every publishable package under `output{,-branded}/**`,
 * 2. `npm pack`s each into a temp dir, and
 * 3. uploads all tarballs to one GitHub Release, tagged `dist-vX.Y-<version>`
 *    (flavor-independent — branded and non-branded share the release).
 *
 * The tag matches the `releases/download/<tag>/...tgz` URLs baked into each
 * umbrella package's dependencies by `gen-packages.mts`, so consumers install
 * with a single tarball URL and no auth.
 *
 * Uploads are **incremental**: each release is read once and only the assets
 * that are missing or whose size differs are uploaded, so re-running (the
 * release workflow runs this on every push to `main`) costs one API call per
 * version instead of re-uploading ~2000 tarballs. See {@link uploadRelease}.
 *
 * Requires an authenticated `gh` CLI (`gh auth status`).
 *
 * Usage:
 *   tsx scripts/cmd/dist-github-release.mts [--version=<range>] [--dry-run] [--force]
 *
 * `--version` limits which versions are released (same syntax as
 * `changeset:all`: `5`, `5.9`, `">=5.3&<=5.5"`); omit to release all.
 * `--force` re-uploads every asset and rewrites the notes, skipping the
 * up-to-date checks.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Arr, hasKey, isRecord, Json, Result } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { $ } from 'ts-repo-utils';
import { type Bundle, collectBundles, packBundle } from '../pack-bundle.mjs';
import { projectRootPath } from '../project-root-path.mjs';
import { parseVersionExpr, versionFromPath } from '../version-filter.mjs';

const packagesDir = path.join(projectRootPath, 'packages');

/**
 * Tarballs per `gh release upload` call. Small batches keep a retry (and the
 * argument list) small. A version now has two assets — one bundle per flavor —
 * so this only ever matters if a future flavor multiplies them again.
 */
const UPLOAD_BATCH_SIZE = 20;

/** Attempts per `gh` call before giving up on a transient API failure. */
const GH_MAX_ATTEMPTS = 4;

/** Backoff before the first `gh` retry, in seconds (doubled each attempt). */
const GH_RETRY_BASE_SEC = 10;

/** Max characters kept from a failed command's output. */
const ERROR_TEXT_MAX_LENGTH = 500;

/**
 * The subset of `gh release view --json body,assets` this script reads. `null`
 * is accepted everywhere `gh` could emit it for an empty value.
 */
const releaseViewType = t.record({
  body: t.optional(t.union([t.string(), t.nullType])),
  assets: t.optional(
    t.union([
      t.array(
        t.record({
          name: t.optional(t.string()),
          size: t.optional(t.number()),
          state: t.optional(t.string()),
        }),
      ),
      t.nullType,
    ]),
  ),
});

/** An existing GitHub Release, as read in a single `gh release view` call. */
type ExistingRelease = Readonly<{
  body: string;
  /** Fully uploaded assets: file name -> byte size. */
  uploadedAssets: ReadonlyMap<string, number>;
}>;

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

  const dryRun = args.includes('--dry-run');

  const force = args.includes('--force');

  const versionExpr = getFlagValue(args, 'version');

  const versionPredicate =
    versionExpr === undefined ? undefined : parseVersionExpr(versionExpr);

  if (versionExpr !== undefined && versionPredicate === undefined) {
    console.error(
      `Invalid --version="${versionExpr}" (examples: 5, 5.9, ">=5.3&<=5.5").`,
    );

    process.exit(1);
  }

  const entries = await fs.readdir(packagesDir, { withFileTypes: true });

  const versionNames = entries
    .filter((e) => e.isDirectory() && /^v\d+\.\d+$/u.test(e.name))
    .map((e) => e.name)
    .filter((name) => {
      const v = versionFromPath(`${path.sep}${name}${path.sep}`);

      return (
        versionPredicate === undefined ||
        (v !== undefined && versionPredicate(v))
      );
    })
    .toSorted((a, b) => a.localeCompare(b));

  if (!Arr.isNonEmpty(versionNames)) {
    console.error(
      versionExpr === undefined
        ? 'No version directories found.'
        : `No versions matched --version="${versionExpr}".`,
    );

    process.exit(1);
  }

  // Sequentially (one release at a time) to keep gh/network load predictable.
  const failures = await versionNames.reduce<Promise<readonly string[]>>(
    async (prev, name) => {
      const acc = await prev;

      const err = await releaseVersion(name, dryRun, force);

      return err === undefined ? acc : Arr.toPushed(acc, err);
    },
    Promise.resolve([]),
  );

  if (Arr.isNonEmpty(failures)) {
    console.error(`\n${failures.length} version(s) failed:`);

    for (const f of failures) {
      console.error(`  ${f}`);
    }

    process.exit(1);
  }

  console.info(dryRun ? '\n[dry-run] done.' : '\nAll releases uploaded. ✅');
};

/** Reads a `--name=value` flag from the argument list. */
const getFlagValue = (
  args: readonly string[],
  name: string,
): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Releases one version's bundles; returns an error message on failure. */
const releaseVersion = async (
  versionName: string,
  dryRun: boolean,
  force: boolean,
): Promise<string | undefined> => {
  const versionRoot = path.join(packagesDir, versionName);

  const bundles = await collectBundles(versionRoot);

  if (!Arr.isNonEmpty(bundles)) {
    console.info(`${versionName}: no bundle packages, skipping.`);

    return undefined;
  }

  const tag = releaseTag(versionName, bundles[0].version);

  console.info(`${versionName}: ${bundles.length} bundles -> release ${tag}`);

  if (dryRun) {
    for (const bundle of bundles) {
      console.info(`  would pack+upload ${bundle.name}@${bundle.version}`);
    }

    return undefined;
  }

  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `dist-${versionName}-`),
  );

  try {
    const tarballs = await Promise.all(
      bundles.map((bundle) => packBundle(bundle, tmpDir)),
    );

    const packErr = tarballs.find(Result.isErr);

    if (packErr !== undefined) {
      return `${versionName}: pack failed: ${packErr.value}`;
    }

    const files = tarballs.filter(Result.isOk).map((r) => r.value);

    const notesFile = path.join(tmpDir, 'RELEASE_NOTES.md');

    await fs.writeFile(
      notesFile,
      buildReleaseNotes(versionName, tag, bundles),
      'utf8',
    );

    return await uploadRelease(tag, versionName, files, notesFile, force);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

/**
 * Builds the GitHub Release notes: one install line per flavor, plus the
 * `tsconfig.json` snippet that points TypeScript at the bundled libs.
 *
 * The notes used to carry a ready-to-paste block of ~107 `devDependencies`
 * entries, because pnpm refuses the URL sub-dependencies an umbrella package
 * declares and pasting every lib was the only way in. A bundle has no
 * sub-dependencies, so one direct URL dependency — which every package manager
 * accepts — is the whole install.
 */
const buildReleaseNotes = (
  versionName: string,
  tag: string,
  bundles: readonly Bundle[],
): string => {
  const installLines = bundles.flatMap((bundle) => [
    `**${bundle.name}**${bundle.name.endsWith('-branded') ? ' (branded numbers)' : ''}:`,
    '',
    '```sh',
    `npm install -D ${tarballUrl(bundle, tag)}`,
    '```',
    '',
  ]);

  const configName = bundles[0]?.name ?? '<package>';

  return [
    `Strict TypeScript ${versionName} standard library, distributed as GitHub Release tarball assets.`,
    '',
    'Every built-in library ships inside one package, so a single dependency is',
    'all a consumer declares — no per-lib entries, and no package-manager',
    'configuration (a direct URL dependency is accepted everywhere; only URL',
    '*sub*-dependencies are not).',
    '',
    '## Install',
    '',
    ...installLines,
    '## Point TypeScript at the libs',
    '',
    '```jsonc',
    '{',
    '    "compilerOptions": {',
    '        "libReplacement": true, // TypeScript 6.0 and later',
    '        "paths": {',
    `            "@typescript/lib-*": ["./node_modules/${configName}/libs/*"],`,
    '        },',
    '    },',
    '}',
    '```',
    '',
    '`paths` is replaced, not merged, by a config that `extends` another, so it',
    'has to be written in whichever config TypeScript actually loads. A missing',
    'entry disables the replacement silently.',
    '',
    'See the repository README for usage and version support.',
    '',
  ].join('\n');
};

/**
 * The release tag of one TypeScript version, e.g. `dist-v7.0-0.2.0`.
 *
 * Flavor-independent: branded and non-branded share one release, which is what
 * `uploadRelease` assumes when it puts both bundles on the same tag.
 */
const releaseTag = (versionName: string, version: string): string =>
  `dist-${versionName}-${version}` as const;

/** Where a bundle's tarball lands once uploaded to its release. */
const tarballUrl = (bundle: Bundle, tag: string): string =>
  `https://github.com/${bundle.repoPath}/releases/download/${tag}/${bundle.name}-${bundle.version}.tgz` as const;

/**
 * Creates or updates the GitHub Release. Returns an error message on failure.
 *
 * Only the assets that are actually missing (or whose size changed) are
 * uploaded. Re-uploading everything with `--clobber` costs two REST calls per
 * asset (delete + upload); across all versions that is ~4000 calls per run,
 * which exhausted the release App installation's hourly quota and failed the
 * job with `HTTP 403: API rate limit exceeded` partway through. `npm pack` is
 * byte-reproducible, so an asset whose size already matches is the same tarball
 * and can be skipped.
 */
const uploadRelease = async (
  tag: string,
  versionName: string,
  files: readonly string[],
  notesFile: string,
  force: boolean,
): Promise<string | undefined> => {
  const title = `${versionName} strict lib (${tag})` as const;

  const viewed = await viewRelease(tag);

  if (Result.isErr(viewed)) {
    return `${versionName}: could not read release ${tag}: ${viewed.value}`;
  }

  const existing = viewed.value;

  if (existing === undefined) {
    // Create the release empty; the assets follow in batches below.
    const created = await runGh(
      `gh release create ${tag} --title "${title}" --notes-file ${notesFile}`,
    );

    if (Result.isErr(created) && !/already exists/iu.test(created.value)) {
      return `${versionName}: gh release create failed: ${created.value}`;
    }
  }

  const pending =
    existing === undefined || force
      ? files
      : await selectOutdatedFiles(files, existing.uploadedAssets);

  if (Arr.isNonEmpty(pending)) {
    const uploaded = await uploadAssets(tag, pending);

    if (Result.isErr(uploaded)) {
      return `${versionName}: gh release upload failed: ${uploaded.value}`;
    }
  }

  // On the create path the notes were written by `gh release create` already.
  const notes =
    existing === undefined
      ? Result.ok(false)
      : await refreshNotes(tag, notesFile, existing.body, force);

  if (Result.isErr(notes)) {
    return `${versionName}: gh release edit failed: ${notes.value}`;
  }

  console.info(
    `  ${versionName}: ${describeOutcome(existing, tag, files.length, pending.length, notes.value)}`,
  );

  return undefined;
};

/**
 * Reads the release for `tag`. Ok(undefined) means there is no such release;
 * Err means the lookup itself failed (e.g. rate limited), which must not be
 * mistaken for a missing release.
 */
const viewRelease = async (
  tag: string,
): Promise<Result<ExistingRelease | undefined, string>> => {
  const result = await $(`gh release view ${tag} --json body,assets`, {
    silent: true,
  });

  if (Result.isErr(result)) {
    const message = errorText(result.value);

    // `gh` exits non-zero with "release not found" when the tag has no release.
    return /release not found/iu.test(message)
      ? Result.ok(undefined)
      : Result.err(message);
  }

  const parsed = Json.parse(result.value.stdout);

  if (Result.isErr(parsed)) {
    return Result.err(`gh release view returned invalid JSON`);
  }

  const validated = releaseViewType.validate(parsed.value);

  if (Result.isErr(validated)) {
    return Result.err(`gh release view returned an unexpected shape`);
  }

  return Result.ok({
    body: validated.value.body ?? '',
    uploadedAssets: new Map(
      (validated.value.assets ?? []).flatMap((asset) =>
        // Anything not fully uploaded (e.g. left over from an aborted run) is
        // treated as missing so it gets re-uploaded.
        asset.state === 'uploaded' &&
        asset.name !== undefined &&
        asset.size !== undefined
          ? [[asset.name, asset.size] as const]
          : [],
      ),
    ),
  });
};

/**
 * The tarballs still to upload: those with no asset of that name, or whose size
 * differs from the uploaded one.
 */
const selectOutdatedFiles = async (
  files: readonly string[],
  uploadedAssets: ReadonlyMap<string, number>,
): Promise<readonly string[]> => {
  const withSizes = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file);

      return { file, size: stat.size };
    }),
  );

  return withSizes
    .filter(
      ({ file, size }) => uploadedAssets.get(path.basename(file)) !== size,
    )
    .map(({ file }) => file);
};

/** Uploads tarballs in batches so a retry never redoes the whole set. */
const uploadAssets = async (
  tag: string,
  files: readonly string[],
): Promise<Result<undefined, string>> =>
  Arr.partition(files, UPLOAD_BATCH_SIZE).reduce<
    Promise<Result<undefined, string>>
  >(
    async (prev, batch) => {
      const acc = await prev;

      if (Result.isErr(acc)) return acc;

      return runGh(`gh release upload ${tag} ${batch.join(' ')} --clobber`);
    },
    Promise.resolve(Result.ok(undefined)),
  );

/**
 * Rewrites the release body when the generated notes differ from the published
 * ones (they change independently of the assets, e.g. when the install
 * instructions are reworded). Ok(true) = the notes were updated.
 */
const refreshNotes = async (
  tag: string,
  notesFile: string,
  publishedBody: string,
  force: boolean,
): Promise<Result<boolean, string>> => {
  const notes = await fs.readFile(notesFile, 'utf8');

  if (!force && normalizeNotes(publishedBody) === normalizeNotes(notes)) {
    return Result.ok(false);
  }

  const edited = await runGh(
    `gh release edit ${tag} --notes-file ${notesFile}`,
  );

  return Result.isErr(edited) ? edited : Result.ok(true);
};

/**
 * Runs a `gh` command, retrying transient GitHub API failures (rate limits,
 * 5xx, dropped connections) with exponential backoff.
 */
const runGh = async (
  command: string,
  attempt: number = 1,
): Promise<Result<undefined, string>> => {
  const result = await $(command);

  if (Result.isOk(result)) return Result.ok(undefined);

  const message = errorText(result.value);

  if (attempt >= GH_MAX_ATTEMPTS || !isTransientFailure(message)) {
    return Result.err(message);
  }

  const waitSec = GH_RETRY_BASE_SEC * 2 ** (attempt - 1);

  console.warn(
    `  transient gh failure, retrying in ${waitSec}s (attempt ${attempt + 1}/${GH_MAX_ATTEMPTS}): ${message}`,
  );

  await sleep(waitSec * 1000);

  return runGh(command, attempt + 1);
};

/** Human-readable summary of what {@link uploadRelease} did. */
const describeOutcome = (
  existing: ExistingRelease | undefined,
  tag: string,
  fileCount: number,
  uploadedCount: number,
  notesUpdated: boolean,
): string => {
  if (existing === undefined) {
    return `created release ${tag} (${fileCount} assets)`;
  }

  if (uploadedCount === 0 && !notesUpdated) {
    return `release ${tag} already up to date (${fileCount} assets)`;
  }

  return `updated release ${tag} (${uploadedCount}/${fileCount} assets uploaded)`;
};

/** GitHub stores release bodies with CRLF line endings. */
const normalizeNotes = (body: string): string =>
  body.replaceAll('\r\n', '\n').trim();

/** Failures worth retrying rather than failing the release for. */
const isTransientFailure = (message: string): boolean =>
  /rate limit|abuse detection|HTTP 5\d\d|timeout|timed out|EOF|socket hang up|ECONNRESET|ETIMEDOUT/iu.test(
    message,
  );

/**
 * The useful part of a failed command. `child_process.exec` puts the whole
 * command line in the first line of the message (`Command failed: <cmd>`) and
 * the process output after it; for an upload of many tarballs that first line
 * would bury the actual API error, so it is dropped.
 */
const errorText = (error: unknown): string => {
  const message =
    isRecord(error) &&
    hasKey(error, 'message') &&
    typeof error.message === 'string'
      ? error.message.trim()
      : '';

  const lines = message.split('\n');

  const details =
    lines[0]?.startsWith('Command failed:') === true
      ? Arr.tail(lines).join('\n').trim()
      : message;

  return (details === '' ? message : details).slice(0, ERROR_TEXT_MAX_LENGTH);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

await main();
