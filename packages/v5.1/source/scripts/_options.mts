import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type CreateContextOptions,
  type VersionConfig,
} from 'strict-ts-lib-scripts-common/context';

const packageRoot = path.resolve(import.meta.dirname, '..', '..');

const versionConfig = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'version-config.json'), 'utf8'),
) as VersionConfig;

export const options: CreateContextOptions = { packageRoot, versionConfig };
