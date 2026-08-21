#!/usr/bin/env tsx

/**
 * Publishes the bundle packages to the **npm registry**.
 *
 * This is the experiment the release strategy hinges on. Publishing the
 * per-lib packages to npm was abandoned because it hit the registry's rate
 * limit: a shared change in the generator fans out to every TypeScript series,
 * which is ~12 series x 2 flavors x ~107 packages ≈ 2,400 publishes, and even
 * one series' 214 was too many. Bundling collapses that to **2 per series** —
 * 24 in total — which is ordinary release traffic.
 *
 * If it goes through, consumers can install from the registry instead of a
 * release URL, and `pnpm update` moves the version for them. If it does not,
 * nothing is lost: the same bundles ship as GitHub Release assets via
 * `dist-github-release.mts`, and the only difference to a consumer is whether
 * the dependency is a `npm:` range or a URL.
 *
 * Requires an authenticated `npm` (`npm whoami`).
 *
 * Usage:
 *   tsx scripts/cmd/dist-npm-publish.mts [--version=<range>] [--publish] [--tag=<dist-tag>]
 *
 * Dry-run unless `--publish` is passed. `--version` limits which versions are
 * published (same syntax as `dist-github-release.mts`: `5`, `5.9`,
 * `">=5.3&<=5.5"`). `--tag` sets the dist-tag; without it npm moves `latest`,
 * which is only right for the newest TypeScript series — publish an older
 * series as e.g. `--tag=v5.9`.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Arr, Result } from 'ts-data-forge';
import { $ } from 'ts-repo-utils';
import { collectBundles, packBundle } from '../pack-bundle.mjs';
import { projectRootPath } from '../project-root-path.mjs';
import { parseVersionExpr, versionFromPath } from '../version-filter.mjs';

const packagesDir = path.join(projectRootPath, 'packages');

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

  const publish = args.includes('--publish');

  const distTag = getFlagValue(args, 'tag');

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

  // Sequentially, so that a rate limit shows up as "the Nth publish failed"
  // rather than as a burst of simultaneous failures.
  const failures = await versionNames.reduce<Promise<readonly string[]>>(
    async (prev, name) => {
      const acc = await prev;

      const err = await publishVersion(name, publish, distTag);

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

  console.info(
    publish
      ? '\nAll bundles published. ✅'
      : '\n[dry-run] done (pass --publish to publish).',
  );
};

/** Reads a `--name=value` flag from the argument list. */
const getFlagValue = (
  args: readonly string[],
  name: string,
): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Publishes one version's bundles; returns an error message on failure. */
const publishVersion = async (
  versionName: string,
  publish: boolean,
  distTag: string | undefined,
): Promise<string | undefined> => {
  const bundles = await collectBundles(path.join(packagesDir, versionName));

  if (!Arr.isNonEmpty(bundles)) {
    console.info(`${versionName}: no bundle packages, skipping.`);

    return undefined;
  }

  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `npm-${versionName}-`),
  );

  try {
    for (const bundle of bundles) {
      const packed = await packBundle(bundle, tmpDir);

      if (Result.isErr(packed)) {
        return `${versionName}: pack failed: ${packed.value}`;
      }

      const flags = [
        '--access public',
        distTag === undefined ? '' : `--tag ${distTag}`,
        publish ? '' : '--dry-run',
      ]
        .filter((flag) => flag !== '')
        .join(' ');

      const result = await $(`npm publish ${packed.value} ${flags}`);

      if (Result.isErr(result)) {
        return `${versionName}: npm publish failed for ${bundle.name}`;
      }

      console.info(
        `  ${publish ? 'published' : 'would publish'} ${bundle.name}@${bundle.version}`,
      );
    }

    return undefined;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

await main();
