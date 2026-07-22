#!/usr/bin/env tsx

/**
 * Publishes every publishable generated package to npm, idempotently.
 *
 * This repo ships ~1700 fine-grained lib packages plus per-version umbrella
 * packages, generated under `packages/vX.Y/output{,-branded}/**`. They are not
 * pnpm workspace members, and there are far too many to publish interactively
 * (npm 2FA prompts per package). This script:
 *
 * 1. discovers every publishable package (`private !== true`, with a `name` and
 *    `version`) under the `output*` trees,
 * 2. skips those whose exact `name@version` is already on the registry
 *    (`npm view`), so it is safe to re-run and it naturally covers both the
 *    first release and later additions (e.g. a new `es2027` lib file), and
 * 3. publishes the rest with bounded concurrency and retries.
 *
 * Authentication is taken from the ambient npm config: set an npm **automation
 * token** (which bypasses 2FA) via `NODE_AUTH_TOKEN` / an `.npmrc` line like
 * `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`. For a manual run under 2FA
 * without an automation token, pass `--otp=<code>` (a single OTP may expire
 * before all packages are published, so an automation token is recommended).
 *
 * Usage:
 *   tsx scripts/cmd/publish-packages.mts [--dry-run] [--otp=<code>] [--concurrency=<n>]
 *
 * Env:
 *   NPM_REGISTRY  registry to publish to (default https://registry.npmjs.org/)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Num, Arr, Json, Result } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { $, glob } from 'ts-repo-utils';
import { projectRootPath } from '../project-root-path.mjs';

const DEFAULT_CONCURRENCY = 8;

const MAX_ATTEMPTS = 3;

const RETRY_BASE_DELAY_MS = 1000;

const registry = process.env['NPM_REGISTRY'] ?? 'https://registry.npmjs.org/';

type Pkg = Readonly<{ name: string; version: string; dir: string }>;

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

  const dryRun = args.includes('--dry-run');

  const otp = getFlagValue(args, 'otp');

  const concurrencyArg = getFlagValue(args, 'concurrency');

  const concurrency =
    concurrencyArg !== undefined && /^[1-9]\d*$/u.test(concurrencyArg)
      ? Result.unwrapOkOr(Num.safeParseFloat(concurrencyArg), Number.NaN)
      : DEFAULT_CONCURRENCY;

  const packages = await collectPublishablePackages();

  if (!Arr.isNonEmpty(packages)) {
    console.error('No publishable packages found under output* trees.');

    process.exit(1);
  }

  console.info(
    `Found ${packages.length} publishable packages. Checking ${registry} ...`,
  );

  const statuses = await mapWithConcurrency(
    packages,
    async (pkg) => ({ pkg, published: await isAlreadyPublished(pkg) }),
    concurrency,
  );

  const toPublish = statuses.filter((s) => !s.published).map((s) => s.pkg);

  console.info(
    `${packages.length - toPublish.length} already published, ${toPublish.length} to publish.`,
  );

  if (!Arr.isNonEmpty(toPublish)) {
    console.info('Nothing to publish. ✅');

    return;
  }

  if (dryRun) {
    console.info('[dry-run] would publish:');

    for (const pkg of toPublish) {
      console.info(`  ${pkg.name}@${pkg.version}`);
    }

    return;
  }

  const results = await mapWithConcurrency(
    toPublish,
    async (pkg) => ({ pkg, result: await publishWithRetry(pkg, otp) }),
    concurrency,
  );

  const failures = results.filter(({ result }) => Result.isErr(result));

  console.info(
    `\nPublished ${results.length - failures.length}/${results.length}.`,
  );

  if (Arr.isNonEmpty(failures)) {
    console.error(`\n${failures.length} package(s) failed to publish:`);

    for (const { pkg, result } of failures) {
      console.error(
        `  ${pkg.name}@${pkg.version}: ${Result.isErr(result) ? result.value : ''}`,
      );
    }

    console.error(
      '\nRe-run this command to retry (already-published are skipped).',
    );

    process.exit(1);
  }

  console.info('All packages published. ✅');
};

/** Reads a `--name=value` flag from the argument list. */
const getFlagValue = (
  args: readonly string[],
  name: string,
): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** The subset of `package.json` fields this script reads. */
const packageJsonType = t.record({
  name: t.optional(t.string()),
  version: t.optional(t.string()),
  private: t.optional(t.boolean()),
});

const parsePackageJson = (
  text: string,
): t.TypeOf<typeof packageJsonType> | undefined => {
  const parsed = Json.parse(text);

  if (Result.isErr(parsed)) return undefined;

  const result = packageJsonType.validate(parsed.value);

  return Result.isOk(result) ? result.value : undefined;
};

/** Discovers all publishable packages under the `output*` trees. */
const collectPublishablePackages = async (): Promise<readonly Pkg[]> => {
  const globbed = await glob(
    [
      path.join(
        projectRootPath,
        'packages',
        '*',
        'output',
        '**',
        'package.json',
      ),
      path.join(
        projectRootPath,
        'packages',
        '*',
        'output-branded',
        '**',
        'package.json',
      ),
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

/** True when `name@version` already exists on the registry. */
const isAlreadyPublished = async (pkg: Pkg): Promise<boolean> => {
  const result = await $(
    `npm view ${pkg.name}@${pkg.version} version --registry=${registry}`,
    { silent: true },
  );

  // A 404 (package/version not found) resolves to Err -> not published yet.
  return Result.isOk(result) && result.value.stdout.trim() !== '';
};

/** Publishes one package, retrying transient failures. */
const publishWithRetry = async (
  pkg: Pkg,
  otp: string | undefined,
  attempt = 1,
): Promise<Result<undefined, string>> => {
  const otpFlag = otp === undefined ? '' : (` --otp=${otp}` as const);

  const result = await $(
    `npm publish --access public --registry=${registry}${otpFlag}`,
    { cwd: pkg.dir },
  );

  if (Result.isOk(result)) {
    console.info(`  published ${pkg.name}@${pkg.version}`);

    return Result.ok(undefined);
  }

  if (attempt >= MAX_ATTEMPTS) {
    return Result.err(result.value.message);
  }

  await sleep(RETRY_BASE_DELAY_MS * attempt);

  return publishWithRetry(pkg, otp, attempt + 1);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs `fn` over `items` with at most `concurrency` in flight, preserving input
 * order in the result. Implemented with recursive workers (no loops) to match
 * the repo's style.
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
