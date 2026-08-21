# strict-ts-lib-v5.3-branded

Strict rewrite of TypeScript 5.3.3's built-in
standard library declarations, distributed as a GitHub Release tarball
(no npm registry, no auth).

```sh
npm install -D https://github.com/noshiro-pf/strict-typescript-lib/releases/download/dist-v5.3-0.4.0/strict-ts-lib-v5.3-branded-0.4.0.tgz
```

Every built-in library ships inside this one package, under `libs/`. Point
TypeScript at them from your `tsconfig.json`:

```jsonc
{
    "compilerOptions": {
        "libReplacement": true, // TypeScript 6.0 and later
        "paths": {
            "@typescript/lib-*": [
                "./node_modules/strict-ts-lib-v5.3-branded/libs/*",
            ],
        },
    },
}
```

`paths` is replaced, not merged, by a config that `extends` another, so it
has to be written in whichever config TypeScript actually loads.

See <https://github.com/noshiro-pf/strict-typescript-lib> for usage and version support.
