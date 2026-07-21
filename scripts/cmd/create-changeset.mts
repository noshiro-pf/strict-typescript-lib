#!/usr/bin/env tsx

/**
 * Creates a single changeset that bumps every publishable package (optionally
 * restricted to a subset of TypeScript versions) at once.
 *
 * This repo publishes ~1700 fine-grained lib packages (one per lib file, for
 * each TypeScript version, branded and non-branded). They are generated under
 * `packages/vX.Y/output/packages/**` and `packages/vX.Y/output-branded/packages/**`
 * and are NOT pnpm workspace members, so `changeset add`'s interactive picker is
 * unusable at that scale. This script discovers them from disk and writes the
 * changeset frontmatter directly. Each package's version is taken from its
 * `packages/vX.Y/` path segment.
 *
 * Usage:
 *   tsx scripts/cmd/create-changeset.mts <major|minor|patch> [summary...] [--version=<range>] [--dry-run]
 *
 * `--version` selects which TypeScript versions to release. Its value is a
 * `&`-separated list of terms (all must hold). A term is a version (`5`, `5.9`,
 * `v5.9`) optionally prefixed by a comparator (`>=`, `<=`, `>`, `<`, `=`):
 *   --version=5             only v5.x (major 5, any minor)
 *   --version=5.9           only v5.9
 *   --version=">=5.3&<=5.5" only v5.3 .. v5.5
 *   --version=">=5.7"       only v5.7 and newer
 * A bare major (`5`) matches the whole major line; a comparator on a bare major
 * (`>=5`) compares at the major level. Omit `--version` to release everything.
 *
 * Examples:
 *   pnpm changeset:all minor "Regenerate lib for TypeScript 5.9"
 *   pnpm changeset:all patch --version=5.9
 *   pnpm changeset:all minor --version=">=5.3&<=5.5"
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Arr, Json, Num, Result } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { glob } from 'ts-repo-utils';
import { projectRootPath } from '../project-root-path.mjs';

const BUMP_TYPES = ['major', 'minor', 'patch'] as const;

type BumpType = (typeof BUMP_TYPES)[number];

type Version = Readonly<{ major: number; minor: number }>;

type VersionPredicate = (v: Version) => boolean;

const changesetDir = path.join(projectRootPath, '.changeset');

const packagesDir = path.join(projectRootPath, 'packages');

const usage =
  'Usage: tsx scripts/cmd/create-changeset.mts <major|minor|patch> [summary...] [--version=<range>] [--dry-run]';

const isBumpType = (value: string): value is BumpType =>
  (BUMP_TYPES as readonly string[]).includes(value);

/** The subset of `package.json` fields this script reads. */
const packageJsonType = t.record({
  name: t.optional(t.string()),
  private: t.optional(t.boolean()),
});

type PackageJson = t.TypeOf<typeof packageJsonType>;

/** The subset of `.changeset/config.json` this script reads. */
const changesetConfigType = t.record({
  ignore: t.optional(t.array(t.string())),
});

/** Extracts the version from a `.../packages/vX.Y/...` path, if present. */
const versionFromPath = (filePath: string): Version | undefined => {
  const m = /[/\\]v(\d+)\.(\d+)[/\\]/u.exec(filePath);

  return m === null ? undefined : { major: Number(m[1]), minor: Number(m[2]) };
};

const compareVersion = (a: Version, b: Version): number =>
  a.major !== b.major ? a.major - b.major : a.minor - b.minor;

const compareByOp = (a: number, b: number, op: string): boolean =>
  op === '>='
    ? a >= b
    : op === '<='
      ? a <= b
      : op === '>'
        ? a > b
        : op === '<'
          ? a < b
          : a === b; // '='

/**
 * Parses one `--version` term (e.g. `5`, `5.9`, `>=5.3`) into a predicate, or
 * `undefined` when malformed. A bare version (no comparator) matches exactly
 * (`5.9`) or the whole major line (`5`); a comparator compares at minor
 * granularity when a minor is given, otherwise at major granularity.
 */
const OPERATORS = ['>=', '<=', '>', '<', '='] as const;

const parseVersionTerm = (term: string): VersionPredicate | undefined => {
  const cleaned = term.replaceAll(/\s+/gu, '');

  const op = OPERATORS.find((o) => cleaned.startsWith(o));

  const rest = op === undefined ? cleaned : cleaned.slice(op.length);

  const digits = rest.startsWith('v') ? rest.slice(1) : rest;

  const [majorStr, minorStr, ...extra] = digits.split('.');

  if (
    !Arr.isEmpty(extra) ||
    majorStr === undefined ||
    !/^\d+$/u.test(majorStr) ||
    (minorStr !== undefined && !/^\d+$/u.test(minorStr))
  ) {
    return undefined;
  }

  const major = Result.unwrapOkOr(Num.safeParseFloat(majorStr), Number.NaN);

  const minor =
    minorStr === undefined
      ? undefined
      : Result.unwrapOkOr(Num.safeParseFloat(minorStr), Number.NaN);

  if (op === undefined) {
    return minor === undefined
      ? (v) => v.major === major
      : (v) => v.major === major && v.minor === minor;
  }

  return minor === undefined
    ? (v) => compareByOp(v.major, major, op)
    : (v) => compareByOp(compareVersion(v, { major, minor }), 0, op);
};

/** Parses a full `--version` expression (`&`-separated terms, all must hold). */
const parseVersionExpr = (expr: string): VersionPredicate | undefined => {
  const predicates = expr
    .split('&')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseVersionTerm);

  return Arr.isEmpty(predicates) || predicates.includes(undefined)
    ? undefined
    : (v) => predicates.every((p) => p?.(v) ?? false);
};

/** Reads a `--name=value` flag from the argument list. */
const getFlagValue = (
  args: readonly string[],
  name: string,
): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const parsePackageJson = (text: string): PackageJson | undefined => {
  const parsed = Json.parse(text);

  if (Result.isErr(parsed)) return undefined;

  const result = packageJsonType.validate(parsed.value);

  return Result.isOk(result) ? result.value : undefined;
};

/**
 * Reads a `package.json` and returns its `name` when the package is
 * publishable (i.e. not `private`); otherwise `undefined`.
 */
const readPublishableName = async (
  packageJsonPath: string,
): Promise<string | undefined> => {
  const pkg = parsePackageJson(await fs.readFile(packageJsonPath, 'utf8'));

  if (pkg === undefined) return undefined;

  return pkg.name !== undefined && pkg.private !== true ? pkg.name : undefined;
};

/** Package names to skip, from `.changeset/config.json`'s `ignore` field. */
const readIgnoredNames = async (): Promise<ReadonlySet<string>> => {
  const parsed = Json.parse(
    await fs.readFile(path.join(changesetDir, 'config.json'), 'utf8'),
  );

  if (Result.isErr(parsed)) return new Set<string>();

  const result = changesetConfigType.validate(parsed.value);

  return new Set(Result.isOk(result) ? (result.value.ignore ?? []) : []);
};

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

  const dryRun = args.includes('--dry-run');

  const [bumpArg, ...summaryParts] = args.filter((a) => !a.startsWith('--'));

  if (bumpArg === undefined || !isBumpType(bumpArg)) {
    console.error(usage);

    process.exit(1);
  }

  const versionExpr = getFlagValue(args, 'version');

  const versionPredicate =
    versionExpr === undefined ? undefined : parseVersionExpr(versionExpr);

  if (versionExpr !== undefined && versionPredicate === undefined) {
    console.error(
      `Invalid --version="${versionExpr}" (examples: 5, 5.9, ">=5.3&<=5.5").`,
    );

    process.exit(1);
  }

  const matchesVersion = (v: Version | undefined): boolean =>
    versionPredicate === undefined
      ? true
      : v !== undefined && versionPredicate(v);

  const scopeLabel = versionExpr ?? 'all';

  const summary = Arr.isNonEmpty(summaryParts)
    ? summaryParts.join(' ')
    : (`Bump ${scopeLabel === 'all' ? 'all packages' : `packages matching "${scopeLabel}"`} (${bumpArg}).` as const);

  const globbed = await glob(path.join(packagesDir, '**', 'package.json'), {
    ignore: ['**/node_modules/**'],
  });

  if (Result.isErr(globbed)) {
    console.error(globbed.value);

    process.exit(1);
  }

  const ignored = await readIgnoredNames();

  const scopedPaths = globbed.value.filter(
    (p) =>
      !p.includes(`${path.sep}node_modules${path.sep}`) &&
      matchesVersion(versionFromPath(p)),
  );

  const resolved = await Promise.all(scopedPaths.map(readPublishableName));

  const names = resolved
    .filter((n): n is string => n !== undefined)
    .filter((n) => !ignored.has(n))
    .toSorted((a, b) => a.localeCompare(b));

  if (Arr.isFixedLengthArray(names, 0)) {
    console.error(
      `No publishable packages matched (scope: ${scopeLabel}). Check --version.`,
    );

    process.exit(1);
  }

  if (dryRun) {
    console.log(
      `[dry-run] would bump ${names.length} packages (${bumpArg}, scope: ${scopeLabel}). First 5:\n  ${Arr.take(names, 5).join('\n  ')}`,
    );

    return;
  }

  const frontmatter = names.map((n) => `"${n}": ${bumpArg}`).join('\n');

  const content = `---\n${frontmatter}\n---\n\n${summary}\n` as const;

  const scopeSlug =
    scopeLabel === 'all'
      ? 'all'
      : scopeLabel.replaceAll(/[^a-z0-9]+/giu, '-').replaceAll(/^-+|-+$/gu, '');

  const filePath = path.join(
    changesetDir,
    `bump-${scopeSlug}-${bumpArg}-${randomUUID().slice(0, 8)}.md`,
  );

  await fs.writeFile(filePath, content, 'utf8');

  console.log(
    `Wrote ${path.relative(projectRootPath, filePath)} bumping ${names.length} packages (${bumpArg}, scope: ${scopeLabel}).`,
  );
};

await main();
