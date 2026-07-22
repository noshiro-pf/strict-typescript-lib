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
 *    `version`) under the `output*` trees, and
 * 2. runs `npm publish` for each, treating "you cannot publish over the
 *    previously published version" as an (idempotent) skip.
 *
 * Because it skips already-published versions, it is safe to re-run and it
 * naturally covers both the first release and later additions (e.g. a new
 * `es2027` lib file). It does NOT pre-query the registry with `npm view`: for a
 * first release that would double the request count and make rate limiting
 * worse.
 *
 * Authentication is taken from the ambient npm config: set an npm **automation
 * token** (which bypasses 2FA) via `NODE_AUTH_TOKEN` / an `.npmrc` line like
 * `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`. For a manual run under 2FA
 * without an automation token, pass `--otp=<code>` (a single OTP may expire
 * before all packages are published, so an automation token is recommended).
 *
 * ## Rate limiting (HTTP 429)
 *
 * Publishing ~1700 *new* package names is exactly what npm's anti-abuse limits
 * target, so 429s are expected. This script defends against them by publishing
 * with low concurrency, a delay between publishes, and long exponential backoff
 * on 429 (up to `MAX_BACKOFF_MS`), retrying each package up to `MAX_ATTEMPTS`
 * times. Tune with `--concurrency` / `--delay`. If a run still gives up on some
 * packages, just re-run it — already-published packages are skipped, so it
 * resumes where it left off. For a very large first release you may need
 * several runs spread over time (or ask npm support to raise the limit).
 *
 * Usage:
 *   tsx scripts/cmd/publish-packages.mts [--version=<range>] [--dry-run] [--otp=<code>] [--concurrency=<n>] [--delay=<ms>]
 *
 * `--version` restricts publishing to a subset of TypeScript versions, using
 * the same syntax as `changeset:all` (e.g. `5`, `5.9`, `">=5.3&<=5.5"`).
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
import { parseVersionExpr, versionFromPath } from '../version-filter.mjs';

// Low, to stay under npm's publish rate limit (429).
const DEFAULT_CONCURRENCY = 2;

// Delay each worker waits before every publish, spacing out requests.
const DEFAULT_DELAY_MS = 250;

const MAX_ATTEMPTS = 8;

// Backoff base for ordinary transient failures.
const RETRY_BASE_DELAY_MS = 2000;

// Backoff base for rate-limit (429) failures — much longer, to wait out the
// limit window rather than hammering it again.
const RATE_LIMIT_BASE_DELAY_MS = 15_000;

// Cap on any single backoff wait.
const MAX_BACKOFF_MS = 300_000;

const registry = process.env['NPM_REGISTRY'] ?? 'https://registry.npmjs.org/';

/** npm's "version already exists" responses (safe to treat as a skip). */
const ALREADY_PUBLISHED_RE =
  /cannot publish over|previously published|cannot modify pre-?existing version|EPUBLISHCONFLICT/iu;

const RATE_LIMIT_RE = /\b429\b|too many requests/iu;

type Pkg = Readonly<{ name: string; version: string; dir: string }>;

type PublishStatus = 'published' | 'skipped';

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

  const dryRun = args.includes('--dry-run');

  const otp = getFlagValue(args, 'otp');

  const concurrencyArg = getFlagValue(args, 'concurrency');

  const concurrency =
    concurrencyArg !== undefined && /^[1-9]\d*$/u.test(concurrencyArg)
      ? Result.unwrapOkOr(Num.safeParseFloat(concurrencyArg), Number.NaN)
      : DEFAULT_CONCURRENCY;

  const delayArg = getFlagValue(args, 'delay');

  const delayMs =
    delayArg !== undefined && /^\d+$/u.test(delayArg)
      ? Result.unwrapOkOr(Num.safeParseFloat(delayArg), Number.NaN)
      : DEFAULT_DELAY_MS;

  const versionExpr = getFlagValue(args, 'version');

  const versionPredicate =
    versionExpr === undefined ? undefined : parseVersionExpr(versionExpr);

  if (versionExpr !== undefined && versionPredicate === undefined) {
    console.error(
      `Invalid --version="${versionExpr}" (examples: 5, 5.9, ">=5.3&<=5.5").`,
    );

    process.exit(1);
  }

  const allPackages = await collectPublishablePackages();

  const packages =
    versionPredicate === undefined
      ? allPackages
      : allPackages.filter((pkg) => {
          const v = versionFromPath(pkg.dir);

          return v !== undefined && versionPredicate(v);
        });

  if (!Arr.isNonEmpty(packages)) {
    console.error(
      versionExpr === undefined
        ? 'No publishable packages found under output* trees.'
        : `No publishable packages matched --version="${versionExpr}".`,
    );

    process.exit(1);
  }

  const scopeLabel = versionExpr ?? 'all';

  console.info(
    `Found ${packages.length} publishable packages (scope: ${scopeLabel}).`,
  );

  if (dryRun) {
    console.info(
      '[dry-run] would attempt to publish (already-published versions are skipped at runtime):',
    );

    for (const pkg of packages) {
      console.info(`  ${pkg.name}@${pkg.version}`);
    }

    return;
  }

  console.info(
    `Publishing to ${registry} (concurrency ${concurrency}, ${delayMs}ms delay) ...`,
  );

  const results = await mapWithConcurrency(
    packages,
    async (pkg) => ({ pkg, result: await publishOne(pkg, otp, delayMs) }),
    concurrency,
  );

  const published = results.filter(
    ({ result }) => Result.isOk(result) && result.value === 'published',
  ).length;

  const skipped = results.filter(
    ({ result }) => Result.isOk(result) && result.value === 'skipped',
  ).length;

  const failures = results.filter(({ result }) => Result.isErr(result));

  console.info(
    `\nPublished ${published}, already-published ${skipped}, failed ${failures.length} (of ${results.length}).`,
  );

  if (Arr.isNonEmpty(failures)) {
    console.error(`\n${failures.length} package(s) failed to publish:`);

    for (const { pkg, result } of failures) {
      console.error(
        `  ${pkg.name}@${pkg.version}: ${Result.isErr(result) ? result.value : ''}`,
      );
    }

    console.error(
      '\nRe-run this command to retry — already-published packages are skipped.',
    );

    process.exit(1);
  }

  console.info('Done. ✅');
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

/**
 * Publishes one package, throttled and with retries. Waits `delayMs` before
 * each attempt to space out requests. An "already published" response is a
 * successful skip; a 429 backs off for much longer than other failures.
 */
const publishOne = async (
  pkg: Pkg,
  otp: string | undefined,
  delayMs: number,
  attempt = 1,
): Promise<Result<PublishStatus, string>> => {
  const otpFlag = otp === undefined ? '' : (` --otp=${otp}` as const);

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const result = await $(
    `npm publish --access public --registry=${registry}${otpFlag}`,
    { cwd: pkg.dir, silent: true },
  );

  if (Result.isOk(result)) {
    console.info(`  published ${pkg.name}@${pkg.version}`);

    return Result.ok('published');
  }

  const message = result.value.message;

  if (ALREADY_PUBLISHED_RE.test(message)) {
    return Result.ok('skipped');
  }

  if (attempt >= MAX_ATTEMPTS) {
    return Result.err(summarizeError(message));
  }

  const rateLimited = RATE_LIMIT_RE.test(message);

  const backoffMs = Math.min(
    (rateLimited ? RATE_LIMIT_BASE_DELAY_MS : RETRY_BASE_DELAY_MS) *
      2 ** (attempt - 1),
    MAX_BACKOFF_MS,
  );

  console.info(
    `  retrying ${pkg.name}@${pkg.version} in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1}/${MAX_ATTEMPTS}${rateLimited ? ', rate-limited' : ''})`,
  );

  await sleep(backoffMs);

  return publishOne(pkg, otp, delayMs, attempt + 1);
};

/** Condenses a multi-line npm error into a short single line for the summary. */
const summarizeError = (message: string): string =>
  Arr.take(
    message
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    3,
  )
    .join(' | ')
    .slice(0, 300);

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
