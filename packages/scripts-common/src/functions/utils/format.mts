import { type Result } from 'ts-data-forge';
import { formatFilesGlob } from 'ts-repo-utils';

export const formatDir = (dir: string): Promise<Result<undefined, unknown>> =>
  formatFilesGlob(`${dir}/**`, { ignore: () => false, ignoreUnknown: true });
