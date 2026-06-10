import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Result, hasKey, isRecord, isString, pipe } from 'ts-data-forge';
import { makeEmptyDir, pathExists } from 'ts-repo-utils';
import { type Context } from '../context.mjs';
import { type ConverterConfig } from '../convert-dts/common.mjs';
import { typeUtilsName } from '../convert-dts/constants.mjs';
import { replaceWithNoMatchCheck } from './utils/node-utils.mjs';

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

  console.log(
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

        console.log(`${outputFile} generated.`);
      }

      // package.json
      {
        const outputFile = path.resolve(outputDir, 'package.json');

        const subPackageName = `${versionConfig.libName}${config.useBrandedNumber ? '-branded' : ''}-${packageRelativePath.replaceAll('/', '-')}`;

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
            peerDependencies: {
              [typeUtilsName]: tsTypeUtilsRange,
              typescript: versionConfig.typescriptVersionRange,
            },
          }),
        );

        console.log(`${outputFile} generated.`);

        return Result.ok(undefined);
      }
    }),
  );

  for (const res of results) {
    if (Result.isErr(res)) {
      return res;
    }
  }

  return Result.ok(undefined);
};

const getPackageDirListFromLibFiles = async (
  ctx: Context,
  config: ConverterConfig,
): Promise<readonly { filename: string; packageRelativePath: string }[]> => {
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

  const packageJson: unknown = JSON.parse(packageJsonStr);

  return isRecord(packageJson) && hasKey(packageJson, 'version')
    ? typeof packageJson.version === 'string'
      ? packageJson.version
      : undefined
    : undefined;
};

const getTsTypeForgeRange = async (
  ctx: Context,
): Promise<string | undefined> => {
  const packageJsonStr = await fs.readFile(
    ctx.paths.strictTsLibSourcePackageJsonPath,
    { encoding: 'utf8' },
  );

  const packageJson: unknown = JSON.parse(packageJsonStr);

  if (!isRecord(packageJson)) return undefined;

  if (!hasKey(packageJson, 'devDependencies')) return undefined;

  if (!isRecord(packageJson.devDependencies)) return undefined;

  if (!hasKey(packageJson.devDependencies, typeUtilsName)) return undefined;

  const value = packageJson.devDependencies[typeUtilsName];

  return isString(value) ? value : undefined;
};
