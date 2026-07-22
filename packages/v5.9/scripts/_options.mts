import { type CreateContextOptions } from 'strict-ts-lib-scripts-common/context';
import { packageRoot } from './package-root.mts';
import { versionConfig } from './version-config.mjs';

export const options: CreateContextOptions = {
  packageRoot,
  versionConfig,
} as const;
