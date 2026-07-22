#!/usr/bin/env tsx

import { runCmdInStagesAcrossWorkspaces } from 'ts-repo-utils';
import { projectRootPath } from '../project-root-path.mjs';

const parsedConcurrency = Number(process.env['WS_GEN_CONCURRENCY']);

const concurrency =
  Number.isSafeInteger(parsedConcurrency) && parsedConcurrency > 0
    ? parsedConcurrency
    : 3;

// `gen:packages` runs only the package-generation slice (`genPackages`
// onward), which reads the committed `output*/lib-files` and re-stamps the
// per-version `-source` version onto every generated package. It does NOT
// touch `temp/` (the gitignored codemod intermediates), so it works on a cold
// CI checkout and is much faster than a full `gen`. This is what the release
// flow needs: propagate the changeset-bumped version, nothing else.
await runCmdInStagesAcrossWorkspaces({
  cmd: 'gen:packages',
  concurrency,
  rootPackageJsonDir: projectRootPath,
});
