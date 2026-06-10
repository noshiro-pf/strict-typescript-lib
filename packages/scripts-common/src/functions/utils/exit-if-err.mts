import { Result, type UnknownResult } from 'ts-data-forge';

export const exitIfErr = (res: UnknownResult): void => {
  if (Result.isErr(res)) {
    console.error(res.value);

    process.exit(1);
  }
};
