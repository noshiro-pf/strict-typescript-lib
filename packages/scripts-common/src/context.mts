import * as path from 'node:path';
import { pipe } from 'ts-data-forge';
import { type ConverterConfig } from './convert-dts/common.mjs';

export type VersionConfig = Readonly<{
  libName: string;
  repo: string;
  license: string;
  /** E.g. `"5.7.2"`. */
  typescriptVersion: string;
  typescriptVersionRange: string;
}>;

const buildPaths = (packageRoot: string) =>
  ({
    root: path.resolve(packageRoot, '../..'),

    strictTsLibSourcePackageJsonPath: path.resolve(
      packageRoot,
      './package.json',
    ),

    strictTsLib: pipe(packageRoot).map((root) => ({
      $: root,

      output: pipe(`${root}/output` as const).map((output) => ({
        $: output,

        diff: {
          $: `${output}/diff` as const,
        },
        lib: {
          $: `${output}/lib` as const,
        },
        libFiles: {
          $: `${output}/lib-files` as const,
        },
        packages: {
          $: `${output}/packages` as const,
        },
      })).value,

      outputBranded: pipe(`${root}/output-branded` as const).map((output) => ({
        $: output,

        diff: {
          $: `${output}/diff` as const,
        },
        lib: {
          $: `${output}/lib` as const,
        },
        libFiles: {
          $: `${output}/lib-files` as const,
        },
        packages: {
          $: `${output}/packages` as const,
        },
      })).value,

      source: pipe(root).map((source) => ({
        $: source,

        packageJson: path.resolve(source, 'package.json'),

        temp: pipe(`${source}/temp` as const).map((temp) => ({
          $: temp,

          copied: {
            $: `${temp}/copied` as const,
          },
          copiedForDiff: {
            $: `${temp}/copied-for-diff` as const,
          },
          codemodFixed: {
            $: `${temp}/codemod-fixed` as const,
          },
        })).value,

        scripts: {
          $: `${source}/scripts` as const,
        },
      })).value,
    })).value,
  }) as const;

export type StrictTsLibPaths = ReturnType<typeof buildPaths>;

const defaultConfigs = [
  {
    useBrandedNumber: false,
    commentOutDeprecated: false,
    returnType: 'mutable',
  },
  {
    useBrandedNumber: true,
    commentOutDeprecated: false,
    returnType: 'readonly',
  },
] as const satisfies readonly ConverterConfig[];

export type Context = Readonly<{
  packageRoot: string;
  paths: StrictTsLibPaths;
  versionConfig: VersionConfig;
  configs: readonly ConverterConfig[];
  packageManagerName: 'pnpm';
}>;

export type CreateContextOptions = Readonly<{
  packageRoot: string;
  versionConfig: VersionConfig;
  configs?: readonly ConverterConfig[];
}>;

export const createContext = (options: CreateContextOptions): Context =>
  ({
    packageRoot: options.packageRoot,
    paths: buildPaths(options.packageRoot),
    versionConfig: options.versionConfig,
    configs: options.configs ?? defaultConfigs,
    packageManagerName: 'pnpm',
  }) as const;
