#!/usr/bin/env tsx

/**
 * Generates, for each TypeScript version, a `scripts/publish-commands.mts` file
 * that lists one `npm publish` command per publishable package.
 *
 * This is a manual, resumable fallback for when `publish-packages.mts` keeps
 * hitting npm's rate limit (429) even for a single version: you can comment out
 * the lines that already published, bump the delay, and run the rest by hand.
 *
 * Output: `packages/vX.Y/scripts/publish-commands.mts` (git-ignored). Run one
 * with:
 *   tsx packages/vX.Y/scripts/publish-commands.mts
 *
 * Usage:
 *   tsx scripts/cmd/gen-publish-commands.mts [--version=<range>]
 *
 * `--version` limits which versions get a file, same syntax as `changeset:all`
 * (e.g. `5`, `5.9`, `">=5.3&<=5.5"`); omit it to (re)generate all versions.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import dedent from 'dedent';
import { Arr, Json, Result } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { glob } from 'ts-repo-utils';
import { projectRootPath } from '../project-root-path.mjs';
import { parseVersionExpr, versionFromPath } from '../version-filter.mjs';

const REGISTRY = 'https://registry.npmjs.org/';

const packagesDir = path.join(projectRootPath, 'packages');

const packageJsonType = t.record({
  name: t.optional(t.string()),
  version: t.optional(t.string()),
  private: t.optional(t.boolean()),
});

type PackageEntry = Readonly<{ name: string; version: string; relDir: string }>;

const main = async (): Promise<void> => {
  const args = Arr.skip(process.argv, 2);

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

  await Promise.all(versionNames.map((name) => writeVersionFile(name)));
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

/** Collects publishable packages for one version, as version-root-relative dirs. */
const collectEntries = async (
  versionRoot: string,
): Promise<readonly PackageEntry[]> => {
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

  const entries = await Promise.all(
    globbed.value.map(
      async (packageJsonPath): Promise<PackageEntry | undefined> => {
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

        const relDir = path
          .relative(versionRoot, path.dirname(packageJsonPath))
          .split(path.sep)
          .join('/');

        return { name: parsed.name, version: parsed.version, relDir };
      },
    ),
  );

  return entries
    .filter((e): e is PackageEntry => e !== undefined)
    .toSorted((a, b) => a.relDir.localeCompare(b.relDir));
};

const writeVersionFile = async (versionName: string): Promise<void> => {
  const versionRoot = path.join(packagesDir, versionName);

  const entries = await collectEntries(versionRoot);

  if (!Arr.isNonEmpty(entries)) {
    console.info(`${versionName}: no publishable packages, skipping.`);

    return;
  }

  const outFile = path.join(versionRoot, 'scripts', 'publish-commands.mts');

  await fs.writeFile(outFile, renderFile(versionName, entries), 'utf8');

  console.info(
    `${versionName}: wrote ${path.relative(projectRootPath, outFile)} (${entries.length} packages)`,
  );
};

const renderFile = (
  versionName: string,
  entries: readonly PackageEntry[],
): string => {
  const commands = entries
    .map((e) => `await publishPkg('${e.relDir}');`)
    .join('\n');

  return `${HEADER(versionName)}\n\n${commands}\n`;
};

// A template literal (not quoted strings) so the generated `${...}` and
// backticks are literal text rather than tripping no-template-curly-in-string.
const HEADER = (versionName: string): string =>
  dedent`
    #!/usr/bin/env tsx

    /*
     * AUTO-GENERATED by \`pnpm gen:publish-commands\` for ${versionName}.
     *
     * One \`npm publish\` per publishable package. Comment out the lines that
     * already published, raise DELAY_MS if you keep hitting HTTP 429, then run:
     *   tsx packages/${versionName}/scripts/publish-commands.mts
     *
     * Re-running is safe: an already-published version just logs an error and is
     * skipped. Regenerate this file with \`pnpm gen:publish-commands\` at any time.
     */

    import * as path from 'node:path';
    import { Result } from 'ts-data-forge';
    import { $ } from 'ts-repo-utils';

    /** Pause between publishes (ms). Increase if you still hit 429. */
    const DELAY_MS = 5000;

    const versionRoot = path.resolve(import.meta.dirname, '..');

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    const publishPkg = async (pkgName: string): Promise<void> => {
      const cmd = \`npm publish \${pkgName} --access public --registry=${REGISTRY}\`;
      console.info(\`$ \${cmd}\`);
      const result = await $(cmd, { cwd: versionRoot });
      if (Result.isErr(result)) {
        console.error(\`  FAILED: \${result.value.message.split('\\n').slice(0, 3).join(' ')}\`);
      }
      await sleep(DELAY_MS);
    };
  `;

await main();
