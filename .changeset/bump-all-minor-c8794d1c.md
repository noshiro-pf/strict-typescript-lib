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

Stop `string & {}` from leaking into key types that are already `string`.

`Object.keys` and `Object.entries` open their key union with a `string & {}` arm
so that the declared keys still autocomplete while the excess keys a wider
object may carry are accepted. That arm only means something for a union of
string literals. Added to a key type that already contains `string` it produced
`string | (string & {})` — which _is_ `string`, just spelled in a way that then
showed up in everything computed from it.

The arm is now added only where it widens something (`WithOpenString`):

| expression                               | before                                                  | after                      |
| ---------------------------------------- | ------------------------------------------------------- | -------------------------- |
| `Object.keys(rec: Record<string, V>)`    | `(string \| (string & {}))[]`                           | `string[]`                 |
| `Object.entries(rec: Record<string, V>)` | `(readonly [string, V] \| readonly [string & {}, V])[]` | `(readonly [string, V])[]` |
| `Object.keys(obj: { a: 1; b: 2 })`       | `('a' \| 'b' \| (string & {}))[]`                       | unchanged                  |
| `Object.entries(obj: { a: 1; b: 2 })`    | keeps the open arm                                      | unchanged                  |

This also fixes `Object.fromEntries(Object.entries(rec).map(...))` on a record
keyed by an index signature. `PartialIfKeyIsUnion` wraps the result in `Partial`
when the key is a union, and the redundant arm made every key type a union — so
`Record<string, V>` came back as `Partial<Record<string | (string & {}), V>>`
and could not be assigned back to the record type it came from. With the arm
gone the key is plain `string`, which is not a union, so the result stays total.
Records with literal keys still get `Partial`, since entries genuinely may not
cover every declared key.

`PartialIfKeyIsUnion` itself is unchanged, as are hand-written entries arrays
and the fixed-length-tuple path.
