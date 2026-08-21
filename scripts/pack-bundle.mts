import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Arr, Json, Result } from 'ts-data-forge';
import * as t from 'ts-fortress';
import { $, glob, pathExists } from 'ts-repo-utils';

/**
 * One flavor's bundle package: `output/lib` (non-branded) or
 * `output-branded/lib` (branded), plus the per-lib directory the tarball is
 * assembled from.
 */
export type Bundle = Readonly<{
  name: string;
  version: string;
  /** `output(-branded)/lib` — holds the bundle's `package.json` and `README.md`. */
  bundleDir: string;
  /** `output(-branded)/packages` — holds one `index.d.ts` per built-in library. */
  packagesDir: string;
  /** `<owner>/<repo>`, from the manifest's `repository.url`. */
  repoPath: string;
}>;

/**
 * The two bundle packages of one TypeScript version, non-branded first.
 *
 * A release used to carry one tarball per built-in library (~107 per flavor,
 * ~214 per version). Nobody installed them one at a time — `libReplacement`
 * loads the whole closure of whatever `lib` is set to — so the split bought
 * the consumer nothing while costing every release ~200 asset uploads and,
 * once distribution moved off a registry, a URL sub-dependency that pnpm
 * refuses by default. One bundle per flavor replaces all of it.
 */
export const collectBundles = async (
  versionRoot: string,
): Promise<readonly Bundle[]> => {
  const found = await Promise.all(
    (['output', 'output-branded'] as const).map(
      async (flavorDir): Promise<Bundle | undefined> => {
        const bundleDir = path.join(versionRoot, flavorDir, 'lib');

        const manifest = parsePackageJson(
          await fs
            .readFile(path.join(bundleDir, 'package.json'), 'utf8')
            .catch(() => ''),
        );

        if (
          manifest === undefined ||
          manifest.private === true ||
          manifest.name === undefined ||
          manifest.version === undefined
        ) {
          return undefined;
        }

        return {
          name: manifest.name,
          version: manifest.version,
          bundleDir,
          packagesDir: path.join(versionRoot, flavorDir, 'packages'),
          repoPath: repoPathOf(manifest.repository?.url ?? ''),
        };
      },
    ),
  );

  return found.filter((b): b is Bundle => b !== undefined);
};

/**
 * Stages a bundle and packs it. Ok = the `.tgz` path, Err = an error message.
 *
 * `libs/` keeps the layout of `output(-branded)/packages` exactly, because that
 * layout is what TypeScript asks for. `getLibraryNameFromLibFileName` turns
 * `lib.es2015.symbol.wellknown.d.ts` into `@typescript/lib-es2015/symbol-wellknown`
 * — the first component after the group is a path segment, the rest are joined
 * with `-` — so one wildcard covers group libs and sub-libs alike:
 *
 *     "@typescript/lib-*": ["./node_modules/<bundle>/libs/*"]
 *
 * Flattening `es2015/symbol-wellknown` to `es2015-symbol-wellknown` looks
 * equivalent and is not: TypeScript never asks for that name, so every sub-lib
 * would quietly keep the stock declarations. Measured with `--traceResolution`:
 * nested resolves 88 of 88 lookups, flattened only 15.
 *
 * No `package.json` is written per lib — a directory holding `index.d.ts` is
 * resolvable without one, and the bundle's own manifest already declares what
 * the declarations need.
 */
export const packBundle = async (
  bundle: Bundle,
  destDir: string,
): Promise<Result<string, string>> => {
  const stageDir = path.join(destDir, `stage-${bundle.name}`);

  const staged = await stageBundle(bundle, stageDir);

  if (Result.isErr(staged)) return staged;

  const packed = await $(`npm pack ${stageDir} --pack-destination ${destDir}`, {
    silent: true,
  });

  if (Result.isErr(packed)) {
    return Result.err(`${bundle.name}: npm pack failed`);
  }

  // `npm pack` of an unscoped package emits `<name>-<version>.tgz`.
  return Result.ok(path.join(destDir, `${bundle.name}-${bundle.version}.tgz`));
};

/** The subset of `package.json` fields this module reads. */
const packageJsonType = t.record({
  name: t.optional(t.string()),
  version: t.optional(t.string()),
  private: t.optional(t.boolean()),
  repository: t.optional(t.record({ url: t.optional(t.string()) })),
});

/** `https://github.com/<owner>/<repo>.git` -> `<owner>/<repo>`. */
const repoPathOf = (repositoryUrl: string): string =>
  /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(repositoryUrl)?.[1] ?? '';

const parsePackageJson = (
  text: string,
): t.TypeOf<typeof packageJsonType> | undefined => {
  const parsed = Json.parse(text);

  if (Result.isErr(parsed)) return undefined;

  const result = packageJsonType.validate(parsed.value);

  return Result.isOk(result) ? result.value : undefined;
};

/** Copies the manifest, the README and every `index.d.ts` into `stageDir`. */
const stageBundle = async (
  bundle: Bundle,
  stageDir: string,
): Promise<Result<undefined, string>> => {
  await fs.mkdir(stageDir, { recursive: true });

  for (const filename of ['package.json', 'README.md']) {
    const from = path.join(bundle.bundleDir, filename);

    if (await pathExists(from)) {
      await fs.copyFile(from, path.join(stageDir, filename));
    }
  }

  const globbed = await glob(path.join(bundle.packagesDir, '**', 'index.d.ts'));

  if (Result.isErr(globbed)) {
    return Result.err(`${bundle.name}: could not read ${bundle.packagesDir}`);
  }

  if (!Arr.isNonEmpty(globbed.value)) {
    return Result.err(
      `${bundle.name}: no index.d.ts under ${bundle.packagesDir}`,
    );
  }

  for (const declarationFile of globbed.value) {
    const libDir = path.join(
      stageDir,
      'libs',
      path.relative(bundle.packagesDir, path.dirname(declarationFile)),
    );

    await fs.mkdir(libDir, { recursive: true });

    await fs.copyFile(declarationFile, path.join(libDir, 'index.d.ts'));
  }

  console.info(
    `  staged ${globbed.value.length} libs for ${bundle.name}@${bundle.version}`,
  );

  return Result.ok(undefined);
};
