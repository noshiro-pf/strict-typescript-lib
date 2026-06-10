import { pipe } from 'ts-data-forge';
import { type MonoTypeFunction } from 'ts-type-forge';
import {
  composeMonoTypeFns,
  replaceWithNoMatchCheck,
} from '../functions/utils/node-utils.mjs';
import {
  idFn,
  typedArrayRef,
  typedArrayRefRegexSource,
  typedArrayUnionRegexSource,
  type ConverterOptions,
} from './common.mjs';

const bigIntArrays = ['BigInt64Array', 'BigUint64Array'] as const;

export const convertLibEs2020Sharedmemory =
  ({
    brandedNumber,
    config: { useBrandedNumber },
    tsLibShape,
  }: ConverterOptions): MonoTypeFunction<string> =>
  (src) =>
    pipe(src).map(
      composeMonoTypeFns(
        ...(!useBrandedNumber
          ? []
          : [
              //
              ' add',
              ' and',
              ' exchange',
              ' or',
              ' store',
              ' sub',
              ' xor',
            ].map((fnName) =>
              replaceWithNoMatchCheck(
                new RegExp(
                  String.raw`${fnName}\(typedArray: ${typedArrayUnionRegexSource(bigIntArrays)}, index: number, value: bigint\): bigint;`,
                  'gu',
                ),
                (['BigInt64', 'BigUint64'] as const)
                  .map(
                    (elementType) =>
                      `${fnName}(typedArray: ${elementType}Array, index: ${brandedNumber.TypedArraySizeArg}, value: ${elementType}): ${elementType};`,
                  )
                  .join('\n'),
              ),
            )),

        !useBrandedNumber
          ? idFn
          : replaceWithNoMatchCheck(
              new RegExp(
                String.raw`compareExchange\(typedArray: ${typedArrayUnionRegexSource(bigIntArrays)}, index: number, expectedValue: bigint, replacementValue: bigint\): bigint;`,
                'gu',
              ),
              (['BigInt64', 'BigUint64'] as const)
                .map(
                  (elementType) =>
                    `compareExchange(typedArray: ${elementType}Array, index: ${brandedNumber.TypedArraySizeArg}, expectedValue: ${elementType}, replacementValue: ${elementType}): ${elementType};`,
                )
                .join('\n'),
            ),

        !useBrandedNumber
          ? idFn
          : replaceWithNoMatchCheck(
              new RegExp(
                String.raw`load\(typedArray: ${typedArrayUnionRegexSource(bigIntArrays)}, index: number\): bigint;`,
                'gu',
              ),
              (['BigInt64', 'BigUint64'] as const)
                .map(
                  (elementType) =>
                    `load(typedArray: ${elementType}Array, index: ${brandedNumber.TypedArraySizeArg}): ${elementType};`,
                )
                .join('\n'),
            ),

        replaceWithNoMatchCheck(
          new RegExp(
            String.raw`wait\(typedArray: ${typedArrayRefRegexSource('BigInt64Array')}, index: number, value: bigint, timeout\?: number\)`,
            'gu',
          ),
          `wait(typedArray: ${typedArrayRef('BigInt64Array', tsLibShape)}, index: ${brandedNumber.TypedArraySizeArg}, value: ${brandedNumber.BigInt64}, timeout?: number)`,
        ),

        replaceWithNoMatchCheck(
          new RegExp(
            String.raw`notify\(typedArray: ${typedArrayRefRegexSource('BigInt64Array')}, index: number, count\?: number\): number`,
            'gu',
          ),
          `notify(typedArray: ${typedArrayRef('BigInt64Array', tsLibShape)}, index: ${brandedNumber.TypedArraySizeArg}, count?: ${brandedNumber.SafeUint}): ${brandedNumber.SafeUint}`,
        ),
      ),
    ).value;
