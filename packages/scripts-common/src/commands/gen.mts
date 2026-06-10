import { createContext, type CreateContextOptions } from '../context.mjs';
import { exitIfErr } from '../functions/utils/exit-if-err.mjs';
import { wrapStartEnd } from '../functions/utils/wrap-start-end.mjs';
import { buildGenSteps, findStepIndex } from './gen-steps.mjs';

/**
 * Run the incremental generation pipeline. Skips the `fetchLibFiles` step;
 * assumes `source/temp/copied/` is already populated.
 */
export const runGen = async (options: CreateContextOptions): Promise<void> => {
  const ctx = createContext(options);

  const steps = buildGenSteps(ctx);

  const start = findStepIndex(steps, 'format temp/copied');

  const end = findStepIndex(steps, `${ctx.packageManagerName} install`) + 1;

  for (const { name, fn } of steps.slice(start, end)) {
    await wrapStartEnd(fn, name).then(exitIfErr);
  }
};
