import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Result } from 'ts-data-forge';
import { makeEmptyDir } from 'ts-repo-utils';
import { type Context } from '../context.mjs';
import { formatDir } from './utils/format.mjs';

type GitHubContentEntry = Readonly<{
  name: string;
  type: 'dir' | 'file' | 'submodule' | 'symlink';
}>;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchWithRetry = async (
  url: string,
  options?: RequestInit,
  attempts = 5,
): Promise<Response> => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (i === attempts - 1) {
        throw error;
      }

      console.warn(`fetch ${url} failed (attempt ${i + 1}); retrying...`);

      await sleep(500 * (i + 1));
    }
  }

  throw new Error('unreachable');
};

/**
 * List the names of `lib.*.d.ts` files in the TypeScript repository at the
 * given tag using the public GitHub Contents API. Authentication is not
 * required for public repositories.
 */
export const fetchLibFileNameList = async (
  tsVersion: string,
): Promise<readonly string[]> => {
  const url = `https://api.github.com/repos/microsoft/TypeScript/contents/lib?ref=v${tsVersion}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'strict-typescript-lib-generator',
  };

  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];

  if (token !== undefined && token !== '') {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch lib directory listing: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const entries = (await response.json()) as readonly GitHubContentEntry[];

  return entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.name)
    .filter((filename) => /^lib.*\.d\.ts$/u.test(filename));
};

/** Fetch lib files from TypeScript repo and save them to `source/temp/copied` */
export const fetchLibFiles = async (
  ctx: Context,
): Promise<Result<undefined, unknown>> => {
  const copiedDir = ctx.paths.strictTsLib.source.temp.copied.$;

  const tsVersion = ctx.versionConfig.typescriptVersion;

  console.log(`TypeScript version: ${tsVersion}.\n`);

  const files = await fetchLibFileNameList(tsVersion);

  await makeEmptyDir(copiedDir);

  try {
    for (const file of files) {
      const url = `https://raw.githubusercontent.com/microsoft/TypeScript/v${tsVersion}/lib/${file}`;

      const response = await fetchWithRetry(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const text = await response.text();

      await fs.writeFile(path.resolve(copiedDir, file), text);

      console.log(`fetched ${file}`);
    }
  } catch (error) {
    console.error(error);

    return Result.err(error);
  }

  {
    const res = await formatDir(copiedDir);

    if (Result.isErr(res)) return res;
  }

  return Result.ok(undefined);
};
