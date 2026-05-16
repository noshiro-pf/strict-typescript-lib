import dedent from 'dedent';
import { pipe } from 'ts-data-forge';
import { type MonoTypeFunction } from 'ts-type-forge';
import {
  composeMonoTypeFns,
  replaceWithNoMatchCheck,
  replaceWithNoMatchCheckBetweenRegexp,
} from '../functions/utils/node-utils.mjs';
import {
  arrayIteratorName,
  closeBraceRegexp,
  enumType,
  idFn,
  typedArrayInterfaceStartRegexp,
  type ConverterOptions,
} from './common.mjs';

// TS 5.6 renamed several iterator interfaces (`IterableIterator` →
// `ArrayIterator` / `MapIterator` / `SetIterator`). Patterns that target the
// new names need to accept the old `IterableIterator` form too.
const arrayIteratorAlt = '(?:Array|Iterable)Iterator';

export const convertLibEs2015Iterable = ({
  brandedNumber,
  readonlyModifier,
  config: { returnType },
  tsLibShape,
}: ConverterOptions): MonoTypeFunction<string> => {
  const ai = arrayIteratorName(tsLibShape);

  return (src) =>
    pipe(src).map(
      composeMonoTypeFns(
        // Array
        replaceWithNoMatchCheckBetweenRegexp({
          startRegexp: 'interface Array<T> {',
          endRegexp: closeBraceRegexp,
          mapFn: composeMonoTypeFns(
            replaceWithNoMatchCheck(
              new RegExp(
                String.raw`${arrayIteratorAlt}<readonly \[number, T\]>`,
                'gu',
              ),
              `${ai}<readonly [${brandedNumber.ArraySize}, T]>`,
            ),
            replaceWithNoMatchCheck(
              new RegExp(`${arrayIteratorAlt}<number>`, 'gu'),
              `${ai}<${brandedNumber.ArraySize}>`,
            ),
          ),
        }),

        // ArrayConstructor
        replaceWithNoMatchCheckBetweenRegexp({
          startRegexp: 'interface ArrayConstructor {',
          endRegexp: closeBraceRegexp,
          mapFn: composeMonoTypeFns(
            returnType === 'readonly'
              ? idFn
              : replaceWithNoMatchCheck(
                  `from<T>(iterable: Iterable<T> | ArrayLike<T>): readonly T[]`,
                  `from<T>(iterable: Iterable<T> | ArrayLike<T>): T[]`,
                ),
            replaceWithNoMatchCheck(
              `from<T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: unknown): readonly U[];`,
              `from<T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: ${brandedNumber.ArraySize}) => U, thisArg?: unknown): ${readonlyModifier}U[];`,
            ),
          ),
        }),

        // ReadonlyArray
        replaceWithNoMatchCheckBetweenRegexp({
          startRegexp: 'interface ReadonlyArray<T> {',
          endRegexp: closeBraceRegexp,
          mapFn: composeMonoTypeFns(
            replaceWithNoMatchCheck(
              new RegExp(
                String.raw`${arrayIteratorAlt}<readonly \[number, T\]>`,
                'gu',
              ),
              `${ai}<readonly [${brandedNumber.ArraySize}, T]>`,
            ),
            replaceWithNoMatchCheck(
              new RegExp(`${arrayIteratorAlt}<number>`, 'gu'),
              `${ai}<${brandedNumber.ArraySize}>`,
            ),
          ),
        }),

        // remove readonly
        replaceWithNoMatchCheck(
          `new (): ReadonlyMap<unknown, unknown>;`,
          `new (): Map<never, never>;`,
        ),

        // remove readonly
        replaceWithNoMatchCheck(
          `new <K, V>(iterable?: Iterable<readonly [K, V]> | null): ReadonlyMap<K, V>`,
          `new <K, V>(iterable?: Iterable<readonly [K, V]> | null): Map<K, V>`,
        ),

        // remove readonly
        replaceWithNoMatchCheck(
          `new <T>(iterable?: Iterable<T> | null): ReadonlySet<T>;`,
          `new <T>(iterable?: Iterable<T> | null): Set<T>;`,
        ),

        replaceWithNoMatchCheck(
          `interface SetConstructor {`,
          dedent`
            interface SetConstructor {
              new (): Set<never>;
          `,
        ),

        ...(
          [
            ['Int8Array', enumType.Int8],
            ['Uint8Array', enumType.Uint8],
            ['Uint8ClampedArray', enumType.Uint8],
            ['Int16Array', brandedNumber.Int16],
            ['Uint16Array', brandedNumber.Uint16],
            ['Int32Array', brandedNumber.Int32],
            ['Uint32Array', brandedNumber.Uint32],
            ['Float32Array', brandedNumber.Float32],
            ['Float64Array', brandedNumber.Float64],
          ] as const
        ).flatMap(([typeName, elementType]) => [
          replaceWithNoMatchCheckBetweenRegexp({
            startRegexp: typedArrayInterfaceStartRegexp(typeName),
            endRegexp: closeBraceRegexp,
            mapFn: composeMonoTypeFns(
              replaceWithNoMatchCheck(
                new RegExp(
                  String.raw`\[Symbol\.iterator\]\(\): ${arrayIteratorAlt}<number>;`,
                  'gu',
                ),
                `[Symbol.iterator](): ${ai}<${elementType}>;`,
              ),
              replaceWithNoMatchCheck(
                new RegExp(
                  String.raw`entries\(\): ${arrayIteratorAlt}<readonly \[number, number\]>;`,
                  'gu',
                ),
                `entries(): ${ai}<readonly [${brandedNumber.TypedArraySize}, ${elementType}]>;`,
              ),
              replaceWithNoMatchCheck(
                new RegExp(
                  String.raw`keys\(\): ${arrayIteratorAlt}<number>;`,
                  'gu',
                ),
                `keys(): ${ai}<${brandedNumber.TypedArraySize}>;`,
              ),
              replaceWithNoMatchCheck(
                new RegExp(
                  String.raw`values\(\): ${arrayIteratorAlt}<number>`,
                  'gu',
                ),
                `values(): ${ai}<${elementType}>`,
              ),
            ),
          }),
          replaceWithNoMatchCheckBetweenRegexp({
            startRegexp: `interface ${typeName}Constructor {`,
            endRegexp: closeBraceRegexp,
            mapFn: composeMonoTypeFns(
              replaceWithNoMatchCheck(
                // Add `<T extends number>` to the bare `from(...)` overload.
                // TS 5.6 and earlier put everything in one signature ending
                // with `, mapfn?: ..., thisArg?: ...)`; TS 5.7+ split into a
                // dedicated single-arg overload; TS 5.8 also renamed the
                // parameter from `arrayLike` to `elements`. Match the common
                // prefix only.
                /from\(\s*(?:arrayLike|elements):\s*Iterable<number>/gu,
                'from<T extends number>(arrayLike: Iterable<T>',
              ),
              replaceWithNoMatchCheck(
                // TS >= 5.7 uses `(v: T, ...)`; earlier versions use
                // `(v: number, ...)`. Normalize both to the typed form.
                /mapfn\?: \(v: (?:T|number), k: number\) => number,/gu,
                `mapfn?: (v: T, k: ${brandedNumber.TypedArraySize}) => ${elementType},`,
              ),
            ),
          }),
        ]),
        replaceWithNoMatchCheckBetweenRegexp({
          startRegexp: 'interface Iterator<',
          endRegexp: closeBraceRegexp,
          mapFn: replaceWithNoMatchCheck(
            // TS 5.6+ uses `next(...[value]:)`; earlier versions use
            // `next(...args:)`.
            'next(...[value]: readonly [] | readonly [TNext]): IteratorResult<T, TReturn>;',
            `next(...[value]: [] | [TNext]): IteratorResult<T, TReturn>;`,
            { onNotFound: 'off' },
          ),
        }),
        returnType === 'readonly'
          ? idFn
          : replaceWithNoMatchCheckBetweenRegexp({
              startRegexp: 'interface PromiseConstructor {',
              endRegexp: closeBraceRegexp,
              mapFn: replaceWithNoMatchCheck(
                '): Promise<readonly Awaited<T>[]>',
                '): Promise<Awaited<T>[]>',
              ),
            }),
      ),
    ).value;
};
