import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Json, Result, pipe } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { $, makeEmptyDir, pathExists } from 'ts-repo-utils';
import { type Context } from '../context.mjs';
import { type ConverterConfig } from '../convert-dts/common.mjs';
import { typeUtilsName } from '../convert-dts/constants.mjs';
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

  await genUmbrellaPackage(ctx, config, packageDirList, subPackageVersion);

  return Result.ok(undefined);
};

/**
 * Generates the umbrella meta-package (`output/lib` / `output-branded/lib`).
 *
 * Installing it alone (`npm install -D strict-ts-lib-vX.Y`) pulls in every
 * per-lib package as a `@typescript/lib-*` alias dependency, so TypeScript's
 * library-replacement picks up the strict declarations without the consumer
 * wiring each alias by hand. It carries no `.d.ts` of its own.
 */
const genUmbrellaPackage = async (
  ctx: Context,
  config: ConverterConfig,
  packageDirList: readonly Readonly<{
    filename: string;
    packageRelativePath: string;
  }>[],
  version: string,
): Promise<void> => {
  const { paths, versionConfig } = ctx;

  const umbrellaDir = path.resolve(
    paths.strictTsLib[config.useBrandedNumber ? 'outputBranded' : 'output']
      .packages.$,
    '..',
    'lib',
  );

  const libPrefix =
    `${versionConfig.libName}${config.useBrandedNumber ? '-branded' : ''}` as const;

  // `@typescript/lib-<name>` (dots -> dashes) resolves to our per-lib package.
  const dependencies = Object.fromEntries(
    packageDirList
      .map(({ packageRelativePath }) =>
        packageRelativePath.replaceAll('/', '-'),
      )
      .toSorted((a, b) => a.localeCompare(b))
      .map(
        (suffix) =>
          [
            `@typescript/lib-${suffix}`,
            `npm:${libPrefix}-${suffix}@${version}`,
          ] as const,
      ),
  );

  await makeEmptyDir(umbrellaDir);

  await fs.writeFile(
    path.resolve(umbrellaDir, 'package.json'),
    JSON.stringify({
      name: libPrefix,
      version,
      private: false,
      description: `Strict TypeScript ${versionConfig.typescriptVersion} standard library (all libs, single install)`,
      repository: { type: 'git', url: versionConfig.repo },
      license: versionConfig.license,
      author: 'noshiro-pf <noshiro.pf@gmail.com>',
      sideEffects: false,
      type: 'module',
      dependencies,
      peerDependencies: {
        typescript: versionConfig.typescriptVersionRange,
      },
    }),
  );

  const repoUrl = versionConfig.repo.replace(/\.git$/u, '');

  await fs.writeFile(
    path.resolve(umbrellaDir, 'README.md'),
    [
      `# ${libPrefix}`,
      '',
      `Strict rewrite of TypeScript ${versionConfig.typescriptVersion}'s built-in`,
      'standard library declarations, bundled as a single package.',
      '',
      '```sh',
      `npm install -D ${libPrefix}`,
      '```',
      '',
      'Installing this package pulls in the strict `@typescript/lib-*` replacements',
      'for every built-in library, so TypeScript picks them up automatically',
      '(library replacement is on by default since TypeScript 4.5).',
      '',
      `See <${repoUrl}> for usage and version support.`,
      '',
    ].join('\n'),
  );

  await $(`pnpm -w run fmt`);

  console.info(`${umbrellaDir} (umbrella package) generated.`);
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

/** "lib.es2018.asynciterable.d.ts" -> "es2018/asynciterable" */
const libFilenameToPath = (libFilename: string): string =>
  libFilename
    .replaceAll('lib.', '')
    .replaceAll('.d.ts', '')
    .replaceAll('.', '/');

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
