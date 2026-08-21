import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Json, Result, pipe } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { makeEmptyDir, pathExists } from 'ts-repo-utils';
import { type Context } from '../context.mjs';
import { type ConverterConfig } from '../convert-dts/common.mjs';
import { typeUtilsName } from '../convert-dts/constants.mjs';
import { formatDir } from './utils/format.mjs';
import { replaceWithNoMatchCheck } from './utils/node-utils.mjs';

/** The subset of `package.json` fields this generator reads. */
const packageJsonType = t.record({
  name: t.optional(t.string()),
  private: t.optional(t.boolean()),
  version: t.optional(t.string()),
  devDependencies: t.optional(t.keyValueRecord(t.string(), t.string())),
});

type PackageJson = t.TypeOf<typeof packageJsonType>;

const parsePackageJson = (jsonStr: string): PackageJson | undefined => {
  const parsed = Json.parse(jsonStr);

  if (Result.isErr(parsed)) return undefined;

  const result = packageJsonType.validate(parsed.value);

  return Result.isOk(result) ? result.value : undefined;
};

/** Generate files to `output/packages` and `output-branded/packages` */
export const genPackages = async (
  ctx: Context,
): Promise<Result<undefined, unknown>> => {
  const results = await Promise.all(
    ctx.configs.map((config) => createPackages(ctx, config)),
  );

  for (const res of results) {
    if (Result.isErr(res)) {
      return res;
    }
  }

  return Result.ok(undefined);
};

// Generate files in `output*\/packages` for one config
const createPackages = async (
  ctx: Context,
  config: ConverterConfig,
): Promise<Result<undefined, unknown>> => {
  const { paths, versionConfig } = ctx;

  await makeEmptyDir(
    paths.strictTsLib[config.useBrandedNumber ? 'outputBranded' : 'output']
      .packages.$,
  );

  const subPackageVersion = await getSubPackageVersion(ctx);

  if (subPackageVersion === undefined) {
    return Result.err(
      `version field is missing in ${paths.strictTsLib.source.packageJson}`,
    );
  }

  const outDir =
    paths.strictTsLib[config.useBrandedNumber ? 'outputBranded' : 'output']
      .packages.$;

  const packageDirList = await getPackageDirListFromLibFiles(ctx, config);

  console.info(
    'target directories:',
    packageDirList.map((a) => path.resolve(outDir, a.packageRelativePath)),
  );

  const tsTypeUtilsRange = await getTsTypeForgeRange(ctx);

  if (tsTypeUtilsRange === undefined) {
    return Result.err(
      `${typeUtilsName} is missing from devDependencies in source/package.json`,
    );
  }

  const results = await Promise.all(
    packageDirList.map(async ({ filename, packageRelativePath }) => {
      const outputDir = path.resolve(outDir, packageRelativePath);

      if (!(await pathExists(outputDir))) {
        await fs.mkdir(outputDir, { recursive: true });
      }

      // index.d.ts (rewrite `<reference path>` back into `<reference lib>`)
      {
        const outputFile = path.resolve(outputDir, 'index.d.ts');

        const content = await fs.readFile(
          path.resolve(
            paths.strictTsLib[
              config.useBrandedNumber ? 'outputBranded' : 'output'
            ].libFiles.$,
            filename,
          ),
          { encoding: 'utf8' },
        );

        await fs.writeFile(
          outputFile,
          pipe(content).map(
            replaceWithNoMatchCheck(
              /\/\/\/ <reference path="\.\/lib\.(.+)\.d\.ts" \/>/gu,
              '/// <reference lib="$1" />',
              {
                onNotFound: 'off',
              },
            ),
          ).value,
        );

        console.info(`${outputFile} generated.`);
      }

      // package.json
      {
        const outputFile = path.resolve(outputDir, 'package.json');

        const subPackageName =
          `${versionConfig.libName}${config.useBrandedNumber ? '-branded' : ''}-${packageRelativePath.replaceAll('/', '-')}` as const;

        await fs.writeFile(
          outputFile,

          JSON.stringify({
            name: subPackageName,
            version: subPackageVersion,
            private: false,
            description: 'Strict TypeScript lib',
            repository: {
              type: 'git',
              url: versionConfig.repo,
            },
            license: versionConfig.license,
            author: 'noshiro-pf <noshiro.pf@gmail.com>',
            sideEffects: false,
            type: 'module',
            types: './index.d.ts',
            // ts-type-forge is a real runtime-resolvable dependency: the
            // generated lib references its types via `import('ts-type-forge')`,
            // so consumers must have it installed (not merely provide it).
            dependencies: {
              [typeUtilsName]: tsTypeUtilsRange,
            },
            peerDependencies: {
              typescript: versionConfig.typescriptVersionRange,
            },
          }),
        );

        console.info(`${outputFile} generated.`);

        return Result.ok(undefined);
      }
    }),
  );

  for (const res of results) {
    if (Result.isErr(res)) {
      return res;
    }
  }

  return genBundlePackage(ctx, config, subPackageVersion, tsTypeUtilsRange);
};

/**
 * Generates the bundle package (`output/lib` and `output-branded/lib`).
 *
 * This is the only package a consumer installs. It carries no `.d.ts` of its
 * own in the working tree: `libs/<name>/index.d.ts` is assembled from
 * `output(-branded)/packages` when the tarball is packed, so the generated tree is not
 * duplicated here.
 *
 * It used to be an umbrella whose dependencies were the ~107 per-lib packages,
 * one URL each, so that a package manager would resolve them transitively and
 * the consumer needed no configuration. That worked while the per-lib packages
 * came from a registry. It stopped working when distribution moved to GitHub
 * Release assets, because pnpm refuses URL *sub*dependencies
 * (`ERR_PNPM_EXOTIC_SUBDEP`) — and lifting that requires `blockExoticSubdeps:
 * false` *and* `publicHoistPattern`, since a transitive dependency never
 * reaches the root `node_modules` where `libReplacement` looks. Shipping the
 * libs inside this package removes both: the only dependency a consumer
 * declares is direct, which pnpm always allows, and `paths` points TypeScript
 * at `libs/*`.
 */
const genBundlePackage = async (
  ctx: Context,
  config: ConverterConfig,
  version: string,
  tsTypeForgeRange: string,
): Promise<Result<undefined, unknown>> => {
  const { paths, versionConfig } = ctx;

  const bundleDir = path.resolve(
    paths.strictTsLib[config.useBrandedNumber ? 'outputBranded' : 'output']
      .packages.$,
    '..',
    'lib',
  );

  const libName =
    `${versionConfig.libName}${config.useBrandedNumber ? '-branded' : ''}` as const;

  const releaseBase = githubReleaseBaseUrl(versionConfig, version);

  const tarballUrl = `${releaseBase}/${libName}-${version}.tgz` as const;

  await makeEmptyDir(bundleDir);

  await fs.writeFile(
    path.resolve(bundleDir, 'package.json'),
    JSON.stringify({
      name: libName,
      version,
      private: false,
      description: `Strict TypeScript ${versionConfig.typescriptVersion} standard library (all libs in one package)`,
      repository: { type: 'git', url: versionConfig.repo },
      license: versionConfig.license,
      author: 'noshiro-pf <noshiro.pf@gmail.com>',
      sideEffects: false,
      type: 'module',
      // Assembled at pack time from `output*/packages`; see `pack-bundle.mts`.
      files: ['libs'],
      // ts-type-forge is a real runtime-resolvable dependency: the generated
      // lib references its types via `import('ts-type-forge')`, so consumers
      // must have it installed (not merely provide it). Declaring it here
      // covers every `libs/*` at once — they resolve it by walking up out of
      // this package's own directory.
      dependencies: {
        [typeUtilsName]: tsTypeForgeRange,
      },
      peerDependencies: {
        typescript: versionConfig.typescriptVersionRange,
      },
    }),
  );

  const repoUrl = versionConfig.repo.replace(/\.git$/u, '');

  await fs.writeFile(
    path.resolve(bundleDir, 'README.md'),
    [
      `# ${libName}`,
      '',
      `Strict rewrite of TypeScript ${versionConfig.typescriptVersion}'s built-in`,
      'standard library declarations, distributed as a GitHub Release tarball',
      '(no npm registry, no auth).',
      '',
      '```sh',
      `npm install -D ${tarballUrl}`,
      '```',
      '',
      'Every built-in library ships inside this one package, under `libs/`. Point',
      'TypeScript at them from your `tsconfig.json`:',
      '',
      '```jsonc',
      '{',
      '    "compilerOptions": {',
      '        "libReplacement": true, // TypeScript 6.0 and later',
      '        "paths": {',
      `            "@typescript/lib-*": ["./node_modules/${libName}/libs/*"],`,
      '        },',
      '    },',
      '}',
      '```',
      '',
      '`paths` is replaced, not merged, by a config that `extends` another, so it',
      'has to be written in whichever config TypeScript actually loads.',
      '',
      `See <${repoUrl}> for usage and version support.`,
      '',
    ].join('\n'),
  );

  // Format only what was just written. The bundle lives at `output*/lib`, one
  // level above `output*/packages`, so the pipeline's `format output*/packages`
  // steps do not reach it — which is why this used to shell out to
  // `pnpm -w run fmt`. That formats the whole repository (~7900 files), and
  // `ws:gen:packages` runs versions concurrently, so those repo-wide passes
  // read and rewrote *other* versions' `output*/packages/**` `package.json`
  // while those versions were still writing them. Two writers on one path
  // leaves a torn file — a minified body followed by the tail of the previous
  // formatted one — and the next oxfmt pass dies parsing it (`Expected ',' or
  // ')' but found 'Identifier'`, exit 2), taking the release down with it.
  const formatRes = await formatDir(bundleDir);

  if (Result.isErr(formatRes)) return formatRes;

  console.info(`${bundleDir} (bundle package) generated.`);

  return Result.ok(undefined);
};

/**
 * Base URL of the GitHub Release that hosts a version's tarball assets, e.g.
 * `https://github.com/<owner>/<repo>/releases/download/dist-v5.9-<version>`.
 * The tag is per TypeScript version (flavor-independent) so branded and
 * non-branded share one release; `dist-github-release.mts` uploads to it.
 */
const githubReleaseBaseUrl = (
  versionConfig: Context['versionConfig'],
  version: string,
): string => {
  const repoPath =
    /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(
      versionConfig.repo,
    )?.[1] ?? '';

  const versionName =
    /v\d+\.\d+/u.exec(versionConfig.libName)?.[0] ?? versionConfig.libName;

  return `https://github.com/${repoPath}/releases/download/dist-${versionName}-${version}`;
};

const getPackageDirListFromLibFiles = async (
  ctx: Context,
  config: ConverterConfig,
): Promise<
  readonly Readonly<{ filename: string; packageRelativePath: string }>[]
> => {
  const libFilesDir =
    ctx.paths.strictTsLib[config.useBrandedNumber ? 'outputBranded' : 'output']
      .libFiles.$;

  const filenames = await fs.readdir(libFilesDir);

  return filenames
    .filter((filename) => /^lib.*\.d\.ts$/u.test(filename))
    .filter((filename) => filename !== 'lib.d.ts')
    .map((filename) => ({
      filename,
      packageRelativePath: libFilenameToPath(filename),
    }));
};

/**
 * "lib.es2018.asynciterable.d.ts" -> "es2018/asynciterable"
 * "lib.es2015.symbol.wellknown.d.ts" -> "es2015/symbol-wellknown"
 *
 * Mirrors TypeScript's own `getLibraryNameFromLibFileName`: only the FIRST
 * component after the lib group becomes a path segment, and any further
 * components are joined with `-`. Replacing every dot with `/` instead nests the
 * three-component lib files one level too deep (`es2015/symbol/wellknown`),
 * which is a subpath `libReplacement` never looks up — so those lib files are
 * published but silently ignored, and consumers keep getting the stock
 * declarations for them.
 */
const libFilenameToPath = (libFilename: string): string => {
  const stem = libFilename.replaceAll('lib.', '').replaceAll('.d.ts', '');

  const firstDot = stem.indexOf('.');

  return firstDot === -1
    ? stem
    : `${stem.slice(0, firstDot)}/${stem
        .slice(firstDot + 1)
        .replaceAll('.', '-')}`;
};

const getSubPackageVersion = async (
  ctx: Context,
): Promise<string | undefined> => {
  const packageJsonStr = await fs.readFile(
    ctx.paths.strictTsLib.source.packageJson,
    { encoding: 'utf8' },
  );

  return parsePackageJson(packageJsonStr)?.version;
};

const getTsTypeForgeRange = async (
  ctx: Context,
): Promise<string | undefined> => {
  const packageJsonStr = await fs.readFile(
    ctx.paths.strictTsLibSourcePackageJsonPath,
    { encoding: 'utf8' },
  );

  const value =
    parsePackageJson(packageJsonStr)?.devDependencies?.[typeUtilsName];

  if (value === undefined) return undefined;

  // Relax the peer range to a major-version match (e.g. "7.2.1" -> "^7.0.0"),
  // so consumers are not pinned to the exact ts-type-forge version the lib was
  // generated with.
  const major = /(\d+)/u.exec(value)?.[1];

  return major === undefined ? undefined : `^${major}.0.0`;
};
