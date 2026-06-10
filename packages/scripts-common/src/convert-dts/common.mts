import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { expectType } from 'ts-data-forge';
import { generateKeyValueRecordFromKeys } from '../functions/utils/node-utils.mjs';

export type ConverterConfig = Readonly<{
  commentOutDeprecated: boolean;
  returnType: 'mutable' | 'readonly';
  useBrandedNumber: boolean;
}>;

export type TsLibShape = Readonly<{
  /**
   * TS 5.7 made the typed-array interfaces (`Int8Array`, `Uint8Array`, ...,
   * `DataView`, `ArrayBufferView`) generic over a `TArrayBuffer extends
   * ArrayBufferLike` parameter. Earlier versions declare them without the
   * generic parameter. Replacement strings that reference typed arrays should
   * branch on this flag to emit `Int8Array<ArrayBufferLike>` vs plain
   * `Int8Array`.
   */
  hasTypedArrayGeneric: boolean;

  /**
   * TS 5.6 introduced the `ArrayIterator` / `MapIterator` / `SetIterator`
   * built-in interfaces. Earlier versions used `IterableIterator` for the
   * same return types. Emit the appropriate name in the replacement string.
   */
  hasArrayIterator: boolean;
}>;

export type ConverterOptions = Readonly<{
  config: ConverterConfig;
  readonlyModifier: '' | 'readonly ';
  brandedNumber: BrandedNumberTypes;
  tsLibShape: TsLibShape;
}>;

/**
 * Compute the `TsLibShape` flags for a given TypeScript version. Bumps to this
 * function happen alongside upstream lib breaking changes.
 */
export const tsLibShapeFor = (tsVersion: string): TsLibShape => {
  const [majorStr, minorStr] = tsVersion.split('.');

  const major = Number(majorStr);

  const minor = Number(minorStr);

  const atLeast = (m: number, n: number): boolean =>
    major > m || (major === m && minor >= n);

  return {
    hasTypedArrayGeneric: atLeast(5, 7),
    hasArrayIterator: atLeast(5, 6),
  };
};

/**
 * Name of the array-iterator return type for the target TS lib shape:
 *   - TS >= 5.6: `ArrayIterator`
 *   - TS  < 5.6: `IterableIterator`
 */
export const arrayIteratorName = (tsLibShape: TsLibShape): string =>
  tsLibShape.hasArrayIterator ? 'ArrayIterator' : 'IterableIterator';

/**
 * Render a typed-array reference appropriate to the target TS lib shape:
 *   - TS >= 5.7: `Int8Array<${genericArg}>` (default `ArrayBufferLike`)
 *   - TS  < 5.7: `Int8Array`
 */
export const typedArrayRef = (
  typeName: string,
  tsLibShape: TsLibShape,
  genericArg: string = 'ArrayBufferLike',
): string =>
  tsLibShape.hasTypedArrayGeneric ? `${typeName}<${genericArg}>` : typeName;

/**
 * Regex source fragment matching the `array: this` (TS 5.7+) or
 * `array: ${typeName}Array` (pre-5.7) parameter form inside typed-array
 * interface bodies.
 */
export const typedArrayThisRegexSource = (typeName: string): string =>
  `(?:this|${typeName})`;

/**
 * Capturing variant of `typedArrayThisRegexSource`. Use `$1` in the
 * replacement string to keep whichever form (`this` or `${typeName}`) the
 * source lib actually used.
 */
export const typedArrayThisCaptureRegexSource = (typeName: string): string =>
  `(this|${typeName})`;

export const closeBraceRegexp = /\n\}\n/gu;

/**
 * Matches `interface ${typeName} {` with an optional
 * `<TArrayBuffer extends ArrayBufferLike>` or
 * `<TArrayBuffer extends ArrayBufferLike = ArrayBufferLike>` generic parameter.
 * TypeScript 5.7 introduced the generic parameter on typed-array interfaces;
 * earlier versions (e.g. TS 5.6) declare them without it.
 */
export const typedArrayInterfaceStartRegexp = (typeName: string): RegExp =>
  new RegExp(
    String.raw`interface ${typeName}(?:<TArrayBuffer extends ArrayBufferLike(?: = ArrayBufferLike)?>)? \{`,
    'u',
  );

/**
 * Regex source fragment that matches a typed-array reference with or without
 * the `<ArrayBufferLike>` generic argument. Use to compose patterns covering
 * both TS 5.7+ (generic) and earlier (non-generic) lib file shapes.
 */
export const typedArrayRefRegexSource = (typeName: string): string =>
  `${typeName}(?:<ArrayBufferLike>)?`;

/**
 * Regex source fragment matching a `|`-joined union of typed-array references,
 * each tolerating an optional `<ArrayBufferLike>` generic argument.
 */
export const typedArrayUnionRegexSource = (
  typeNames: readonly string[],
): string => typeNames.map(typedArrayRefRegexSource).join(String.raw` \| `);

export const enumType = generateKeyValueRecordFromKeys([
  'Int8',
  'Uint8',
] as const);

const brandedNumberFromTypeUtils = [
  'FiniteNumber',
  'Int',
  'NaNType',
  'NEGATIVE_INFINITY',
  'POSITIVE_INFINITY',
  'PositiveNumber',
  'NonNegativeNumber',
  'InfiniteNumber',
  'Int16',
  'Uint16',
  'Int32',
  'Uint32',
  'Float32',
  'Float64',
  'BigInt64',
  'BigUint64',
  'SafeInt',
  'SafeUint',
  'NegativeInt32',
] as const;

const brandedNumbers = [
  'StringSize',
  'ArraySize',
  'TypedArraySize',

  'StringSizeArgPositive',
  'ArraySizeArgPositive',
  'TypedArraySizeArgPositive',

  'StringSizeArgNonNegative',
  'ArraySizeArgNonNegative',
  'TypedArraySizeArgNonNegative',

  'StringSizeArg',
  'ArraySizeArg',
  'TypedArraySizeArg',

  'StringSearchResult',
  'ArraySearchResult',
  'TypedArraySearchResult',

  'NewArrayMaxSize',

  // YearEnum is not present in ts-type-forge globals; we add it as an alias
  // of SafeUint inside the generated `declare namespace NumberType`.
  'YearEnum',

  ...brandedNumberFromTypeUtils,
] as const;

const BrandedNumberName = generateKeyValueRecordFromKeys(
  brandedNumbers,
) satisfies BrandedNumberTypes;

export type BrandedNumberTypes = Record<
  (typeof brandedNumbers)[number],
  (typeof brandedNumbers)[number] | 'bigint' | 'number' | `NumberType.${string}`
>;

const tupleMap = <T extends readonly unknown[], B>(
  tpl: T,
  mapFn: (a: T[number]) => B,
): { readonly [K in keyof T]: B } =>
  tpl.map(mapFn) as {
    readonly [K in keyof T]: B;
  };

const set = new Set(brandedNumberFromTypeUtils);

export const createBrandedNumber = (
  useBrandedNumber: boolean,
): BrandedNumberTypes =>
  Object.fromEntries(
    tupleMap(
      brandedNumbers,
      (key) =>
        [
          key,
          !useBrandedNumber
            ? key === 'BigInt64' || key === 'BigUint64'
              ? 'bigint'
              : 'number'
            : set.has(key)
              ? key
              : prependNamespacePrefix(BrandedNumberName[key]),
        ] as const,
    ),
  ) satisfies BrandedNumberTypes;

const prependNamespacePrefix = (s: string): `NumberType.${string}` =>
  `NumberType.${s}`;

export const brandedNumberTypeDefString = (): string => {
  const {
    StringSize,
    ArraySize,
    TypedArraySize,
    ArraySizeArgPositive,
    TypedArraySizeArgPositive,
    StringSizeArgPositive,
    StringSizeArgNonNegative,
    ArraySizeArgNonNegative,
    TypedArraySizeArgNonNegative,
    StringSizeArg,
    ArraySizeArg,
    TypedArraySizeArg,
    StringSearchResult,
    ArraySearchResult,
    TypedArraySearchResult,
    NewArrayMaxSize,
    YearEnum,

    ...rest
  } = BrandedNumberName;

  expectType<keyof typeof rest, (typeof brandedNumberFromTypeUtils)[number]>(
    '=',
  );

  const { SafeUint, Uint32, PositiveNumber, NegativeInt32, SafeInt } = rest;

  return [
    '/**',
    ' * https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Array/length',
    ' * https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/String/length',
    ' *',
    ' *     Max array length : 2^32 - 1',
    ' *     Max string length : 2^53 - 1',
    ' */',
    'declare namespace NumberType {',
    `  export type ${StringSize} = ${SafeUint};`,
    `  export type ${ArraySize} = ${Uint32};`,
    `  export type ${TypedArraySize} = ${SafeUint};`, // 要出典
    '',
    `  export type ${ArraySizeArgPositive} = WithSmallInt<IntersectBrand<${PositiveNumber}, ${ArraySize}>>;`,
    `  export type ${TypedArraySizeArgPositive} = WithSmallInt<IntersectBrand<${PositiveNumber}, ${TypedArraySize}>>;`,
    `  export type ${StringSizeArgPositive} = WithSmallInt<IntersectBrand<${PositiveNumber}, ${StringSize}>>;`,
    '',
    `  export type ${StringSizeArgNonNegative} = WithSmallInt<${StringSize}>;`,
    `  export type ${ArraySizeArgNonNegative} = WithSmallInt<${ArraySize}>;`,
    `  export type ${TypedArraySizeArgNonNegative} = WithSmallInt<${TypedArraySize}>;`,
    '',
    `  export type ${StringSizeArg} = WithSmallInt<${SafeInt}>;`,
    `  export type ${ArraySizeArg} = WithSmallInt<${NegativeInt32} | ${ArraySize}>;`,
    `  export type ${TypedArraySizeArg} = WithSmallInt<${SafeInt}>;`,
    '',
    `  export type ${StringSearchResult} = ${StringSize} | -1;`,
    `  export type ${ArraySearchResult} = ${ArraySize} | -1;`,
    `  export type ${TypedArraySearchResult} = ${TypedArraySize} | -1;`,
    '',
    `  export type ${NewArrayMaxSize} = ${ArraySize};`,
    '',
    `  export type ${YearEnum} = ${SafeUint};`,
    '}',
  ].join('\n');
};

export const getSrcFileList = async (
  srcDir: string,
): Promise<readonly Readonly<{ filename: string; content: string }>[]> => {
  const distFileNameList = await fs.readdir(srcDir);

  const distFileContentList = await Promise.all(
    distFileNameList.map((filename) =>
      fs.readFile(path.resolve(srcDir, filename), { encoding: 'utf8' }),
    ),
  );

  const distFileList: readonly Readonly<{
    filename: string;
    content: string;
  }>[] = distFileNameList.map((filename, index) => ({
    filename,
    content: distFileContentList[index] ?? '',
  }));

  return distFileList;
};

export const idFn = (s: string): string => s;
