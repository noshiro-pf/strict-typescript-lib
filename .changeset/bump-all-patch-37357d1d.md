---
'strict-ts-lib-v5.0-source': patch
'strict-ts-lib-v5.1-source': patch
'strict-ts-lib-v5.2-source': patch
'strict-ts-lib-v5.3-source': patch
'strict-ts-lib-v5.4-source': patch
'strict-ts-lib-v5.5-source': patch
'strict-ts-lib-v5.6-source': patch
'strict-ts-lib-v5.7-source': patch
'strict-ts-lib-v5.8-source': patch
'strict-ts-lib-v5.9-source': patch
'strict-ts-lib-v6.0-source': patch
'strict-ts-lib-v7.0-source': patch
---

Fix `Set` / `Map` subclassing, tighten the collection constructors, and publish three lib files at the subpath TypeScript actually looks up.

- `SetConstructor.prototype` / `MapConstructor.prototype` were narrowed to
  `Set<never>` / `Map<never, never>`, which made every `class X extends Set<T>`
  and `class X extends Map<K, V>` fail with TS2417 — `prototype` is what the
  `extends` clause checks a subclass's static side against. They are now the
  `ReadonlySet<unknown>` / `ReadonlyMap<unknown, unknown>` form, matching how
  `ArrayConstructor.prototype` is already declared. The protection against an
  untyped `new Set()` / `new Map()` swallowing anything is unchanged: it comes
  from the constructor overloads, not from `prototype`.
- `lib.es2015.symbol.wellknown`, `lib.es2016.array.include` and
  `lib.es2020.symbol.wellknown` were published one directory level too deep
  (`es2015/symbol/wellknown` instead of `es2015/symbol-wellknown`), a subpath
  `libReplacement` never resolves — so consumers silently got the stock
  declarations for those three libs. They now land where TypeScript looks.
- An untyped `new WeakSet()` / `new WeakMap()` no longer accepts every object.
  Both now default to `never`, like `new Set()` / `new Map()` already did.
  `new WeakSet<object>()` and `new WeakMap<object, number>()` keep working,
  because the no-argument overload carries its own type parameters.
- `null` is no longer an accepted initializer for any of the four collection
  constructors. Upstream allows `new Set(null)` because the runtime tolerates
  it, but a `null` reaching a collection constructor is a bug at the call site
  rather than an intentional "start empty" — `new Set()` says that already.
  Passing a plain optional still works (`(xs?: readonly T[]) => new Set(xs)`);
  code that types its own parameter as `... | null` and forwards it has to drop
  the `| null`. **This is the one change here that can require a consumer edit.**
- `Temporal.PartialTemporalLike` no longer trips this lib's narrowed
  `Exclude<T, U extends T>` (TS2344).
