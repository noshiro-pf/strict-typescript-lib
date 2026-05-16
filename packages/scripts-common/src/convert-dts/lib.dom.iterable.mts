import { pipe } from 'ts-data-forge';
import { type MonoTypeFunction } from 'ts-type-forge';
import {
  composeMonoTypeFns,
  replaceWithNoMatchCheck,
} from '../functions/utils/node-utils.mjs';
import { type ConverterOptions } from './common.mjs';

export const convertLibDomIterable =
  ({ brandedNumber }: ConverterOptions): MonoTypeFunction<string> =>
  (src) =>
    pipe(src).map(
      composeMonoTypeFns(
        replaceWithNoMatchCheck(
          'entries(): ArrayIterator<readonly [number,',
          `entries(): ArrayIterator<readonly [${brandedNumber.ArraySize},`,
        ),
        replaceWithNoMatchCheck(
          'keys(): ArrayIterator<number>;',
          `keys(): ArrayIterator<${brandedNumber.ArraySize}>;`,
        ),
      ),
    ).value;
