import { pipe } from 'ts-data-forge';
import { type MonoTypeFunction } from 'ts-type-forge';
import {
  composeMonoTypeFns,
  replaceWithNoMatchCheck,
  replaceWithNoMatchCheckBetweenRegexp,
} from '../functions/utils/node-utils.mjs';
import { closeBraceRegexp, type ConverterOptions } from './common.mjs';

export const convertLibEs2015Collection =
  ({ brandedNumber }: ConverterOptions): MonoTypeFunction<string> =>
  (src) =>
    pipe(src).map(
      composeMonoTypeFns(
        replaceWithNoMatchCheck(
          // change Set.has() and Map.has() to accept widen literal types
          'has(key: K): boolean;',
          'has(key: K | (WidenLiteral<K> & {})): boolean;',
        ),

        replaceWithNoMatchCheck(
          'has(value: T): boolean;',
          'has(value: T | (WidenLiteral<T> & {})): boolean;',
        ),

        replaceWithNoMatchCheck(
          //
          'size: number',
          `size: ${brandedNumber.ArraySize}`,
        ),

        replaceWithNoMatchCheckBetweenRegexp({
          startRegexp: 'interface MapConstructor {',
          endRegexp: closeBraceRegexp,
          mapFn: composeMonoTypeFns(
            replaceWithNoMatchCheck(
              'ReadonlyMap<unknown, unknown>;',
              'Map<never, never>;',
            ),
            replaceWithNoMatchCheck(
              //
              '): ReadonlyMap<K, V>;',
              '): Map<K, V>;',
            ),
          ),
        }),

        replaceWithNoMatchCheckBetweenRegexp({
          startRegexp: 'interface SetConstructor {',
          endRegexp: closeBraceRegexp,
          mapFn: composeMonoTypeFns(
            replaceWithNoMatchCheck(
              //
              'new <T = unknown>',
              'new <T = never>',
            ),
            replaceWithNoMatchCheck(
              //
              'ReadonlySet<T>;',
              'Set<T>;',
            ),
            replaceWithNoMatchCheck(
              'prototype: ReadonlySet<unknown>',
              'prototype: Set<never>',
            ),
          ),
        }),
      ),
    ).value;
