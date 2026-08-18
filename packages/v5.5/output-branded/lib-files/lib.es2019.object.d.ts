/// <reference no-default-lib="true"/>
/// <reference lib="es5" />

/// <reference path="./lib.es2015.iterable.d.ts" />

declare namespace StrictLibInternals {
  type RecursionLimit = 20;

  /**
   * - `[['x', 1], ['y', 3]]` -> `{ x: 1, y: 3 }`
   *
   * @internal
   */
  export type EntriesToObject<
    Entries extends readonly (readonly [PropertyKey, unknown])[],
  > = Readonly<EntriesToObjectImpl<{}, Entries>>;

  /** @internal */
  type EntriesToObjectImpl<
    R,
    Entries extends readonly (readonly [PropertyKey, unknown])[],
  > = import('ts-type-forge').TypeEq<Entries['length'], 0> extends true
    ? R
    : EntriesToObjectImpl<
        R & { readonly [key in Entries[0][0]]: Entries[0][1] },
        import('ts-type-forge').List.Tail<Entries>
      >;

  /**
   * - `['x' | 'y' | 'z', number][]]` -> `'x' | 'y' | 'z'`
   * - `[['a' | 'b' | 'c', number], ...['x' | 'y' | 'z', number][]]` -> `'a' | 'b' |
   *   'c' | 'x' | 'y' | 'z'`
   *
   * @internal
   *
   * @note 上の2個目の例に対応するためには、無限長の Entries に対しても再帰を回す必要があるが、
   * 止めるタイミングを決められないので再帰制限を設けている。
   */
  export type KeysOfEntries<
    Entries extends readonly (readonly [PropertyKey, unknown])[],
  > = KeysOfEntriesImpl<never, Entries, RecursionLimit>;

  /** @internal */
  type KeysOfEntriesImpl<
    K,
    Entries extends readonly (readonly [PropertyKey, unknown])[],
    RemainingNumRecursions extends number,
  > = import('ts-type-forge').TypeEq<RemainingNumRecursions, 0> extends true
    ? K
    : import('ts-type-forge').TypeEq<Entries['length'], 0> extends true
      ? K
      : KeysOfEntriesImpl<
          K | Entries[0][0],
          import('ts-type-forge').List.Tail<Entries>,
          import('ts-type-forge').Decrement<RemainingNumRecursions>
        >;

  /** @internal */
  export type ValuesOfEntries<
    Entries extends readonly (readonly [PropertyKey, unknown])[],
  > = ValuesOfEntriesImpl<never, Entries, RecursionLimit>;

  /** @internal */
  type ValuesOfEntriesImpl<
    K,
    Entries extends readonly (readonly [PropertyKey, unknown])[],
    RemainingNumRecursions extends number,
  > = import('ts-type-forge').TypeEq<RemainingNumRecursions, 0> extends true
    ? K
    : import('ts-type-forge').TypeEq<Entries['length'], 0> extends true
      ? K
      : ValuesOfEntriesImpl<
          K | Entries[0][1],
          import('ts-type-forge').List.Tail<Entries>,
          import('ts-type-forge').Decrement<RemainingNumRecursions>
        >;

  /**
   * `Object.entries` adds a `string & {}` arm to the key union so that
   * excess properties are representable. That arm is not a key the caller
   * declared, so it is dropped before deciding whether `Partial` is needed.
   *
   * @internal
   */
  export type StripOpenStringKey<K> = K extends unknown
    ? import('ts-type-forge').TypeEq<K, string & {}> extends true
      ? never
      : K
    : never;

  /** @internal */
  export type PartialIfKeyIsUnion<K, T> = import('ts-type-forge').IsUnion<
    StripOpenStringKey<K>
  > extends true
    ? Partial<T>
    : T;
}

interface ObjectConstructor {
  /**
   * Returns an object created by key-value entries for properties and methods
   * @param entries An iterable object that contains key-value entries for properties and methods.
   *
   * @example
   *   const entries = [
   *     ['x', 1],
   *     ['y', 3],
   *   ] as const satisfies [['x', 1], ['y', 3]];
   *
   *   const obj = Object.fromEntries(entries) satisfies { x: 1; y: 3 };
   *
   * @note `entries` がタプル型の場合には key-value の組み合わせも反映した型にする。
   * そうでない場合、 `K` が union 型の場合、`entries` がそのすべてを網羅しているとは限らないため、
   * `fromEntries` の返り値型がその union 要素すべてを含む型になってしまわないように `Partial` を付けている。
   *
   * ただし `K` が index signature（`string` など無限のキー集合）の場合は `Partial` を付けない。
   * 網羅すべき具体的なキーが存在せず、`noUncheckedIndexedAccess` により添字アクセスの時点で
   * `undefined` が付くため、`Partial` は情報を増やさずに `Record<string, V>` への代入を妨げるだけになる。
   * 判定の際は `Object.entries` が超過プロパティ表現のために加える `string & {}` の arm を除外する
   * （これを残すと `Record<string, V>` すら union 扱いになり `Partial` が付いてしまう）。
   */
  fromEntries<
    const Entries extends readonly (readonly [PropertyKey, unknown])[],
  >(
    entries: Entries,
  ): import('ts-type-forge').IsFixedLengthList<Entries> extends true
    ? StrictLibInternals.EntriesToObject<Entries>
    : StrictLibInternals.PartialIfKeyIsUnion<
        StrictLibInternals.KeysOfEntries<Entries>,
        Record<
          StrictLibInternals.KeysOfEntries<Entries>,
          StrictLibInternals.ValuesOfEntries<Entries>
        >
      >;

  /**
   * Returns an object created by key-value entries for properties and methods
   * @param entries An iterable object that contains key-value entries for properties and methods.
   *
   * @example
   *   const entries: readonly (readonly ['x' | 'y' | 'z' | 4, 1 | 2 | 3])[] = [
   *     ['x', 1],
   *     ['y', 2],
   *     ['z', 3],
   *     [4, 3],
   *   ] as const;
   *
   *   const obj = Object.fromEntries(entries); // Record<'x' | 'y' | 'z' | 4, 1 | 2 | 3>
   *
   */
  fromEntries<K extends PropertyKey, V>(
    entries: Iterable<readonly [K, V]>,
  ): Record<K, V>;

  /**
   * Returns an object created by key-value entries for properties and methods
   * @param entries An iterable object that contains key-value entries for properties and methods.
   */
  fromEntries(entries: Iterable<readonly unknown[]>): unknown;
}
