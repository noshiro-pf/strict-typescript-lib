import { pipe } from 'ts-data-forge';
import { type MonoTypeFunction } from 'ts-type-forge';
import {
  composeMonoTypeFns,
  replaceWithNoMatchCheck,
} from '../functions/utils/node-utils.mjs';
import { arrayIteratorName, type ConverterOptions } from './common.mjs';

export const convertLibDomIterable =
  ({ brandedNumber, tsLibShape }: ConverterOptions): MonoTypeFunction<string> =>
  (src) => {
    const ai = arrayIteratorName(tsLibShape);

    return pipe(src).map(
      composeMonoTypeFns(
        replaceWithNoMatchCheck(
          // TS 5.6+ uses `ArrayIterator`; earlier versions used
          // `IterableIterator`.
          /entries\(\): (?:Array|Iterable)Iterator<readonly \[number,/gu,
          `entries(): ${ai}<readonly [${brandedNumber.ArraySize},`,
        ),
        replaceWithNoMatchCheck(
          /keys\(\): (?:Array|Iterable)Iterator<number>;/gu,
          `keys(): ${ai}<${brandedNumber.ArraySize}>;`,
        ),
      ),
    ).value;
  };
