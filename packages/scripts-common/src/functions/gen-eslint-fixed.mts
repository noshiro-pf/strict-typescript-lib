import { chdir } from 'node:process';
import { Result } from 'ts-data-forge';
import { $, makeEmptyDir } from 'ts-repo-utils';
import { type Context } from '../context.mjs';

/**
 * Read files in `source/temp/copied` and generate files in
 * `source/temp/eslint-fixed`
 */
export const genEslintFixed = async (
  ctx: Context,
): Promise<Result<undefined, unknown>> => {
  const { copied, eslintFixed } = ctx.paths.strictTsLib.source.temp;

  await makeEmptyDir(eslintFixed.$);

  {
    const res = await $(`cp -r ${copied.$}/lib*.d.ts ${eslintFixed.$}`);

    if (Result.isErr(res)) {
      console.error(res.value);

      return res;
    }
  }

  chdir(ctx.paths.strictTsLib.source.$);

  {
    const res = await $(
      `pnpm run zz:eslint ${eslintFixed.$} --config ./configs/eslint.config.gen.mts --fix || true`,
    );

    if (Result.isErr(res)) {
      console.error(res.value);

      return res;
    }
  }

  return Result.ok(undefined);
};
