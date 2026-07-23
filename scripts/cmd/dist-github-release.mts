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
 * with a single tarball URL and no auth. Re-running re-uploads with `--clobber`.
 *
 * Requires an authenticated `gh` CLI (`gh auth status`).
 *
 * Usage:
 *   tsx scripts/cmd/dist-github-release.mts [--version=<range>] [--dry-run]
 *
 * `--version` limits which versions are released (same syntax as
 * `changeset:all`: `5`, `5.9`, `">=5.3&<=5.5"`); omit to release all.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Arr, Json, Result } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { $, glob } from 'ts-repo-utils';
import { projectRootPath } from '../project-root-path.mjs';
import { parseVersionExpr, versionFromPath } from '../version-filter.mjs';

const packagesDir = path.join(projectRootPath, 'packages');

const PACK_CONCURRENCY = 8;

const packageJsonType = t.record({
  name: t.optional(t.string()),
  version: t.optional(t.string()),
  private: t.optional(t.boolean()),
  dependencies: t.optional(t.keyValueRecord(t.string(), t.string())),
});

type Pkg = Readonly<{ name: string; version: string; dir: string }>;

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

  const dryRun = args.includes('--dry-run');

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

      const err = await releaseVersion(name, dryRun);

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

const parsePackageJson = (
  text: string,
): t.TypeOf<typeof packageJsonType> | undefined => {
  const parsed = Json.parse(text);

  if (Result.isErr(parsed)) return undefined;

  const result = packageJsonType.validate(parsed.value);

  return Result.isOk(result) ? result.value : undefined;
};

/** Releases one version's packages; returns an error message on failure. */
const releaseVersion = async (
  versionName: string,
  dryRun: boolean,
): Promise<string | undefined> => {
  const versionRoot = path.join(packagesDir, versionName);

  const tag = await readReleaseTag(versionRoot);

  if (tag === undefined) {
    return `${versionName}: could not determine release tag (is output/lib generated?)`;
  }

  const packages = await collectPublishablePackages(versionRoot);

  if (!Arr.isNonEmpty(packages)) {
    console.info(`${versionName}: no publishable packages, skipping.`);

    return undefined;
  }

  console.info(`${versionName}: ${packages.length} packages -> release ${tag}`);

  if (dryRun) {
    for (const pkg of Arr.take(packages, 3)) {
      console.info(`  would pack+upload ${pkg.name}@${pkg.version}`);
    }

    return undefined;
  }

  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `dist-${versionName}-`),
  );

  try {
    const tarballs = await mapWithConcurrency(
      packages,
      (pkg) => packOne(pkg, tmpDir),
      PACK_CONCURRENCY,
    );

    const packErr = tarballs.find(Result.isErr);

    if (packErr !== undefined) {
      return `${versionName}: pack failed: ${packErr.value}`;
    }

    const files = tarballs.filter(Result.isOk).map((r) => r.value);

    return await uploadRelease(tag, versionName, files);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

/** Extracts the release tag from an umbrella package's tarball-URL deps. */
const readReleaseTag = async (
  versionRoot: string,
): Promise<string | undefined> => {
  const umbrella = parsePackageJson(
    await fs
      .readFile(path.join(versionRoot, 'output', 'lib', 'package.json'), 'utf8')
      .catch(() => ''),
  );

  const firstUrl = Object.values(umbrella?.dependencies ?? {})[0];

  return firstUrl === undefined
    ? undefined
    : /\/releases\/download\/([^/]+)\//u.exec(firstUrl)?.[1];
};

const collectPublishablePackages = async (
  versionRoot: string,
): Promise<readonly Pkg[]> => {
  const globbed = await glob(
    [
      path.join(versionRoot, 'output', '**', 'package.json'),
      path.join(versionRoot, 'output-branded', '**', 'package.json'),
    ],
    { ignore: ['**/node_modules/**'] },
  );

  if (Result.isErr(globbed)) {
    console.error(globbed.value);

    process.exit(1);
  }

  const packages = await Promise.all(
    globbed.value.map(async (packageJsonPath): Promise<Pkg | undefined> => {
      const parsed = parsePackageJson(
        await fs.readFile(packageJsonPath, 'utf8'),
      );

      if (
        parsed === undefined ||
        parsed.private === true ||
        parsed.name === undefined ||
        parsed.version === undefined
      ) {
        return undefined;
      }

      return {
        name: parsed.name,
        version: parsed.version,
        dir: path.dirname(packageJsonPath),
      };
    }),
  );

  return packages
    .filter((p): p is Pkg => p !== undefined)
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

/** Packs one package; Ok = the .tgz path, Err = an error message. */
const packOne = async (
  pkg: Pkg,
  destDir: string,
): Promise<Result<string, string>> => {
  const result = await $(`npm pack ${pkg.dir} --pack-destination ${destDir}`, {
    silent: true,
  });

  if (Result.isErr(result)) {
    return Result.err(`${pkg.name}: ${result.value.message.slice(0, 200)}`);
  }

  // `npm pack` of an unscoped package emits `<name>-<version>.tgz`.
  return Result.ok(path.join(destDir, `${pkg.name}-${pkg.version}.tgz`));
};

/** Creates (or re-uploads to) the GitHub Release. Returns an error message on failure. */
const uploadRelease = async (
  tag: string,
  versionName: string,
  files: readonly string[],
): Promise<string | undefined> => {
  const title = `${versionName} strict lib (${tag})` as const;

  const notes =
    'Strict TypeScript standard library tarballs. Install via the umbrella ' +
    'tarball URL — see the repository README.';

  const fileArgs = files.join(' ');

  const created = await $(
    `gh release create ${tag} --title "${title}" --notes "${notes}" ${fileArgs}`,
  );

  if (Result.isOk(created)) {
    console.info(
      `  ${versionName}: created release ${tag} (${files.length} assets)`,
    );

    return undefined;
  }

  // Most likely the release already exists — re-upload, clobbering assets.
  const uploaded = await $(`gh release upload ${tag} ${fileArgs} --clobber`);

  if (Result.isOk(uploaded)) {
    console.info(
      `  ${versionName}: updated release ${tag} (${files.length} assets)`,
    );

    return undefined;
  }

  return `${versionName}: gh release failed: ${uploaded.value.message.slice(0, 200)}`;
};

/**
 * Runs `fn` over `items` with at most `concurrency` in flight, preserving input
 * order. Recursive workers (no loops) to match the repo's style.
 */
const mapWithConcurrency = async <A, B>(
  items: readonly A[],
  fn: (item: A) => Promise<B>,
  concurrency: number,
): Promise<readonly B[]> => {
  const mut_results: B[] = [];

  const mut_queue = items.map((item, index) => ({ item, index }));

  const worker = async (): Promise<void> => {
    const next = mut_queue.shift();

    if (next === undefined) return;

    mut_results[next.index] = await fn(next.item);

    await worker();
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return mut_results;
};

await main();
