---
'strict-ts-lib-v5.0-source': minor
'strict-ts-lib-v5.1-source': minor
'strict-ts-lib-v5.2-source': minor
'strict-ts-lib-v5.3-source': minor
'strict-ts-lib-v5.4-source': minor
'strict-ts-lib-v5.5-source': minor
'strict-ts-lib-v5.6-source': minor
'strict-ts-lib-v5.7-source': minor
'strict-ts-lib-v5.8-source': minor
'strict-ts-lib-v5.9-source': minor
'strict-ts-lib-v6.0-source': minor
'strict-ts-lib-v7.0-source': minor
---

`Object.fromEntries` no longer returns `Partial` for index-signature records.

`Object.entries` adds a `string & {}` arm to the key union so that excess
properties stay representable. That arm made `IsUnion` true for every record,
so `PartialIfKeyIsUnion` wrapped even `Record<string, V>` in `Partial` — and
`Object.fromEntries(Object.entries(rec).map(...))` could not be assigned back
to the record type it came from.

The arm is now stripped before the union check, which leaves `Partial` in place
exactly where entries may fail to cover a declared key:

| entries built from    | before         | after          |
| --------------------- | -------------- | -------------- |
| `Record<string, V>`   | `Partial<...>` | total          |
| `Record<number, V>`   | `Partial<...>` | total          |
| `{ a: 1; b: 2 }`      | `Partial<...>` | `Partial<...>` |
| `Record<'a'\|'b', V>` | `Partial<...>` | `Partial<...>` |
| `{ a: 1 }`            | `Partial<...>` | total          |

An index signature names no specific key that could go missing, and
`noUncheckedIndexedAccess` already adds `| undefined` on access, so `Partial`
added nothing there. The single-literal-key case drops `Partial` because
`Object.entries` on such an object always yields that key.

Hand-written entries arrays and the fixed-length-tuple path are unaffected.
