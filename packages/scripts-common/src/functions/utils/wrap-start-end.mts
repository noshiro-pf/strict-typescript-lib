import { type UnknownResult } from 'ts-data-forge';

export const wrapStartEnd = async (
  fn: () => Promise<UnknownResult>,
  fnName: string,
): Promise<UnknownResult> => {
  console.log(`\nStart ${fnName}`);

  const res = await fn();

  console.log(`Done.\n`);

  return res;
};
