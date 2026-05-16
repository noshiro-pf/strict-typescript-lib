# strict-typescript-lib 設計ドキュメント

TypeScript 標準 lib (`lib.es5.d.ts` など) を厳格化した置き換え用型定義を、TypeScript の各バージョンごとに npm パッケージとして生成・配布するためのリポジトリ。

参考実装:

- [noshiro-pf/mono `packages/strict-ts-lib`](https://github.com/noshiro-pf/mono/tree/main/packages/strict-ts-lib)
- [tier4/webauto-typescript-shared `packages/strict-ts-lib`](https://github.com/tier4/webauto-typescript-shared/tree/main/packages/strict-ts-lib)

## 1. 決定事項サマリ

| 項目                  | 決定                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Repo 構成             | pnpm モノレポ + TS バージョン別パッケージ                                                       |
| 型ユーティリティ      | `ts-type-forge` (peerDependencies)                                                              |
| npm 名 prefix         | スコープなし (`strict-ts-lib-...`)                                                              |
| TS バージョン token   | `v5.7` (ドット付き)                                                                             |
| Branded 配布          | 別 npm パッケージ。命名順序は `strict-ts-lib-v{TS}-branded-{lib}`                               |
| ベース                | webauto をベースに mono の branded configs を復活                                               |
| 生成ツールチェーン    | `tsx` 直接実行 (webauto 流)                                                                     |
| 補助ライブラリ        | `ts-codemod-lib` / `ts-repo-utils` / `ts-data-forge` (webauto の `@tier4/node-utils` の代替)    |
| ライセンス            | Apache-2.0                                                                                      |
| 配布レジストリ        | npmjs.com (Changesets で公開)                                                                   |
| 生成物の git 管理     | コミットする (diff レビューと CI 安定のため)                                                    |
| 実装順                | v5.7 → ≥4.5 & <6.0 → ≥6.0 → ≤4.4                                                              |

## 2. リポジトリ構成

現在の typescript-template scaffold (`src/`, `samples/`, `configs/rollup.config.ts`, `vite.doc.config.mts`, `vitest.config.mts` 等) は撤去し、pnpm モノレポに置き換える。`AGENTS.md` / `.github` / `.prettierrc` / `eslint.config.mts` / `LICENSE` 等の共通設定は流用する。

```text
strict-typescript-lib/
├── package.json                         # workspace root (private: true)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mts
├── .prettierrc / .gitignore / ...
├── .changeset/                          # 公開時の changesets ファイル
├── AGENTS.md                            # submodule
├── README.md
├── docs/
│   └── design.md                        # 本ドキュメント
├── scripts/
│   ├── project-root-path.mts
│   └── cmd/
│       ├── check-all.mts                # gen → diff チェック → tsc → lint を含む
│       └── check-ext.mts
├── scripts-common/                      # TS バージョン横断の生成ロジック
│   ├── package.json                     # name: "strict-ts-lib-scripts-common", private: true
│   └── src/
│       ├── commands/                    # entry points
│       │   ├── gen.mts
│       │   ├── gen-full.mts
│       │   ├── gen-min.mts
│       │   ├── gen-lib-files.mts
│       │   ├── gen-packages.mts
│       │   ├── gen-ci.mts
│       │   ├── fmt-diff.mts
│       │   └── publish-packages.mts
│       ├── functions/
│       │   ├── fetch-lib-files.mts
│       │   ├── gen-lib-files.mts
│       │   ├── gen-eslint-fixed.mts
│       │   ├── gen-diff.mts
│       │   ├── gen-packages.mts
│       │   ├── get-package-dir-list.mts
│       │   ├── constants.mts            # libName/repo/license/configs/paths
│       │   └── utils/
│       │       ├── replace-with-no-match-check.mts        # @tier4/node-utils から移植
│       │       ├── compose-mono-type-fns.mts              # 同上
│       │       ├── replace-with-no-match-check-between-regexp.mts
│       │       ├── generate-key-value-record-from-keys.mts
│       │       ├── exit-if-err.mts
│       │       ├── wrap-start-end.mts
│       │       ├── format.mts
│       │       ├── clear-dir.mts                          # mono の utils を取り込む
│       │       └── get-typescript-version.mts
│       ├── convert-dts/                 # 文字列置換ルール (webauto ベース)
│       │   ├── common.mts
│       │   ├── constants.mts
│       │   ├── convert-main.mts
│       │   ├── convert-return-type-to-uint-range.mts
│       │   ├── dom-common.mts
│       │   └── lib.*.mts                # 多数
│       └── strategies/                  # lib 差し替え方式の戦略 (フェーズ 3/4 で拡張)
│           └── ts-4-5-to-5-x.mts
└── packages/
    └── v5.7/
        ├── source/                      # 開発側 (private: true)
        │   ├── package.json             # name: "strict-ts-lib-v5.7-source"
        │   ├── typescript-version.txt   # "5.7.2"
        │   ├── package-root.mts
        │   ├── scripts/
        │   │   └── version-config.mts   # libName, repo, license 等の上書き
        │   ├── configs/
        │   │   └── eslint.config.gen.mts
        │   └── temp/                    # 中間生成物 (gitignore)
        │       ├── copied/
        │       ├── copied-for-diff/
        │       └── eslint-fixed/
        ├── output/                      # 非 branded 生成物 (公開対象)
        │   ├── lib-files/               # 変換済み lib (フラット配置)
        │   ├── packages/                # 配布用 sub package 群
        │   │   ├── es5/
        │   │   │   ├── package.json     # name: "strict-ts-lib-v5.7-es5"
        │   │   │   └── index.d.ts
        │   │   ├── es2015/core/
        │   │   │   ├── package.json     # name: "strict-ts-lib-v5.7-es2015-core"
        │   │   │   └── index.d.ts
        │   │   ├── dom/iterable/
        │   │   │   └── ...              # name: "strict-ts-lib-v5.7-dom-iterable"
        │   │   └── ...
        │   ├── diff/                    # 公式 lib との差分 (.diff)
        │   ├── test/                    # 型動作確認用テスト
        │   ├── package.json             # private: true (テスト用)
        │   └── tsconfig.json
        └── output-branded/              # branded 生成物 (公開対象)
            ├── lib-files/
            ├── packages/                # name: "strict-ts-lib-v5.7-branded-es5" 等
            ├── diff/
            ├── test/
            ├── package.json
            └── tsconfig.json
```

要点:

- `scripts-common` は workspace パッケージ。`packages/v*/source` から `workspace:*` で参照する。
- `packages/vX.Y/source/package.json` は `private: true`。公開対象は `output*/packages/*/` 配下のみ。
- TS バージョン固有の override が必要になったら、`packages/vX.Y/source/scripts/version-config.mts` から `scripts-common` の hook ポイント (関数引数 / オプション) に差し込む。フェーズ 1 では override 不要。
- `output*/` は git commit する (両参考実装と同じ運用)。

## 3. npm 公開命名規約

| 種別                          | パッケージ名                                                |
| ----------------------------- | ----------------------------------------------------------- |
| 非 branded・top lib           | `strict-ts-lib-v5.7-es5`, `strict-ts-lib-v5.7-dom`, ...      |
| 非 branded・sub lib           | `strict-ts-lib-v5.7-es2015-core`, `strict-ts-lib-v5.7-dom-iterable`, ... |
| branded                       | `strict-ts-lib-v5.7-branded-es5`, `strict-ts-lib-v5.7-branded-dom-iterable`, ... |

- `version`: 通常の semver。例: `1.0.0`。webauto の `5.7.2-strict-lib-v9` 方式は採らない (TS バージョンは名前で表現)。
- 各サブパッケージは `peerDependencies` を持つ:
  - `ts-type-forge`: `^N` (利用ライブラリのバージョンに従う)
  - `typescript`: 対応する TS バージョン範囲。例: v5.7 系 → `">=5.7.0 <5.8.0"`
- npm 規約: 内部にドットを含むパッケージ名は許容される (例: `socket.io`)。先頭が `.`/`_` の新規名は不可だが、`strict-ts-lib-v5.7-...` は問題なし。
- 利用者は package.json のエイリアス機能で `@typescript/lib-xxx` にマップする:

  ```json
  {
    "devDependencies": {
      "@typescript/lib-es5": "npm:strict-ts-lib-v5.7-es5@^1",
      "@typescript/lib-dom": "npm:strict-ts-lib-v5.7-dom@^1"
    }
  }
  ```

  branded 利用は `npm:strict-ts-lib-v5.7-branded-es5@^1` に差し替え。branded と非 branded の混在は非対応。

- パッケージ名生成ロジック (`gen-packages.mts` 内):

  ```ts
  const flat = packageRelativePath.replaceAll('/', '-');
  const name = `${libName}${config.useBrandedNumber ? '-branded' : ''}-${flat}`;
  // libName = "strict-ts-lib-v5.7", flat = "dom-iterable"
  //   → "strict-ts-lib-v5.7-dom-iterable"
  //   branded: "strict-ts-lib-v5.7-branded-dom-iterable"
  ```

  TypeScript コンパイラは `<reference lib="dom.iterable" />` を `@typescript/lib-dom-iterable` (ドットを `-` に置換) に解決するため、npm 名側にドットを含めなくても動作する。

## 4. ベース移植マッピング

webauto/source/scripts/src/ → 当 repo scripts-common/src/ への移植時:

| webauto 側                                                                 | 当 repo 側                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@tier4/node-utils` の `replaceWithNoMatchCheck`, `composeMonoTypeFns`, `replaceWithNoMatchCheckBetweenRegexp`, `generateKeyValueRecordFromKeys` | `ts-codemod-lib` に同等品があればそれを使う。無いものは `scripts-common/src/functions/utils/` に自前実装で取り込む |
| `constants.mts` の `libName = '@tier4/strict-typescript-lib'`              | `libName = 'strict-ts-lib-v5.7'` (version-config から注入)                                       |
| `repo = '.../webauto-typescript-shared.git'`                               | `repo = 'https://github.com/noshiro-pf/strict-typescript-lib.git'`                               |
| `license = 'ISC'`                                                          | `license = 'Apache-2.0'`                                                                         |
| `typeUtilsName = 'ts-type-forge'`, `typeUtilsGlobalName = 'ts-type-forge/global'` | そのまま流用                                                                                     |
| `configs: [{ useBrandedNumber: false, ... }]` (1 エントリ)                 | mono の 2 エントリ版を復活: 非 branded + branded                                                |
| webauto 追加の `lib.es2022.sharedmemory.mts`                               | 採用 (mono には無い)                                                                             |
| `package-root.mts` (`paths.strictTsLib` の起点)                            | 各 `packages/vX.Y/source/package-root.mts` に置き、`scripts-common` 側は引数経由で受け取る       |
| mono の `fmt-diff.mts`, `publish-packages.mts`, `clear-dir.mts`            | 取り込む                                                                                         |
| webauto の `gen-packages.mts` で `packageRelativePath.replaceAll('/', '-')` | そのまま採用                                                                                     |
| `gen-eslint-fixed.mts` 内の `pnpm run zz:eslint --config ./configs/eslint.config.gen.mts` | 各 `packages/vX.Y/source/configs/eslint.config.gen.mts` を参照                                   |

`configs` を 2 エントリにすることで自動的に `output/` と `output-branded/` が並列生成される。

## 5. 共通生成パイプライン

webauto の `gen-steps` をそのまま踏襲:

```text
1. fetchLibFiles               # gh api + wget で TS GitHub から取得 → source/temp/copied/
2. format temp/copied          # prettier
3. genEslintFixed              # eslint --fix で readonly 付与 → source/temp/eslint-fixed/
4. genLibFiles                 # convert-dts の置換ルールを適用 → output*/lib-files/
5. format output/lib-files     # prettier
6. prepareCopiedForDiff        # 元 lib をコピーして diff 用に整える
7. genDiff                     # diff (output/lib-files vs copied-for-diff) → output/diff/
8. genPackages                 # output*/packages/*/{package.json,index.d.ts} 生成
9. format output*/packages     # prettier
10. pnpm install               # workspace 内 link を更新
```

各 step は引数で対象バージョンディレクトリ (`packages/v5.7`) を受け取り、その配下の `source/temp/`, `output/`, `output-branded/` に対して動作する。

## 6. 戦略パターン (フェーズ 3/4 を見据えた抽象化)

`scripts-common/src/strategies/` に lib 差し替え方式の戦略を分離。フェーズ 1 では `ts-4-5-to-5-x.mts` のみ実装。

```ts
// scripts-common/src/strategies/types.mts
export type LibReplacementStrategy = Readonly<{
  /** README 用の利用方法サンプル */
  generateReadmeUsage: (libName: string, packageVersion: string) => string;

  /** root package.json の devDependencies に書き込む @typescript/lib-* 群 */
  buildRootDeps: (
    libDirs: readonly string[],
    libName: string,
    packageVersion: string,
  ) => Record<`@typescript/lib-${string}`, string>;

  /** sub package.json に追加するフィールド (engines, files など) */
  augmentSubPackageJson?: (base: PackageJson, libDir: string) => PackageJson;
}>;
```

| TS 範囲         | 戦略概要                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| ≥4.5 & <6.0    | `@typescript/lib-xxx` のパッケージ自動解決。webauto/mono と同じ。                                                 |
| ≥6.0           | 仕様確定後にフェーズ 3 で追記。差し替えメカニズムが変わる場合は本戦略を分岐させる。                                |
| ≤4.4           | `@typescript/lib-xxx` 非対応。フェーズ 4 で `tsconfig.paths` / `typeRoots` 等の代替メカニズムを実装。              |

## 7. ルート tooling

ルート `package.json` の主要 scripts (抜粋):

```jsonc
{
  "scripts": {
    "check-all": "tsx ./scripts/cmd/check-all.mts",
    "check:ext": "tsx ./scripts/cmd/check-ext.mts",

    "v5.7:gen": "pnpm --filter strict-ts-lib-v5.7-source gen",
    "v5.7:gen:full": "pnpm --filter strict-ts-lib-v5.7-source gen:full",
    "v5.7:gen:packages": "pnpm --filter strict-ts-lib-v5.7-source gen:packages",
    "v5.7:test": "pnpm --filter strict-ts-lib-v5.7-source test",

    "gen:all": "pnpm -r --filter './packages/v*/source' gen",
    "test:all": "pnpm -r --filter './packages/v*/source' test",

    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "fmt": "prettier --write .",
    "cspell": "cspell \"**\" --gitignore --no-progress",
    "md": "markdownlint-cli2"
  }
}
```

各 `packages/v5.7/source/package.json`:

```jsonc
{
  "name": "strict-ts-lib-v5.7-source",
  "private": true,
  "type": "module",
  "scripts": {
    "gen": "tsx ../../../scripts-common/src/commands/gen.mts --package-root ../",
    "gen:full": "tsx ../../../scripts-common/src/commands/gen-full.mts --package-root ../",
    "gen:packages": "tsx ../../../scripts-common/src/commands/gen-packages.mts --package-root ../",
    "gen:lib-files": "tsx ../../../scripts-common/src/commands/gen-lib-files.mts --package-root ../",
    "test": "tsc -p ../output/tsconfig.json && tsc -p ../output-branded/tsconfig.json"
  },
  "dependencies": {
    "strict-ts-lib-scripts-common": "workspace:*"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "ts-type-forge": "^3.0.1",
    "ts-data-forge": "^6.9.6",
    "ts-repo-utils": "^10.0.3",
    "ts-codemod-lib": "^2.1.7"
  }
}
```

## 8. check-all 拡張

`scripts/cmd/check-all.mts` を以下のステップで再構成する:

1. `pnpm i`
2. `pnpm run cspell`
3. `pnpm run check:ext`
4. `pnpm run gen:all` — TS 各バージョンの生成を実行
5. **`git diff --exit-code` で `output*/` の変更が無いことを確認** (生成が再現可能であることを保証)
6. `pnpm run test:all` — `output*/tsconfig.json` を `tsc -p` で型チェック
7. `pnpm run lint`
8. `pnpm run md`
9. `pnpm run fmt:full` (差分が出ないことを確認)

旧 scaffold 由来の `build` / `doc` / `gh:backup-all` ステップは削除する。

## 9. CI / 公開

- CI: `pnpm check-all` を実行することで「生成 + 型チェック + 各種 lint」を 1 コマンドで検証。
- 公開: [Changesets](https://github.com/changesets/changesets) を導入し、`output*/packages/*/` の各サブパッケージを npmjs.com に publish。バージョンは TS バージョンごとに独立して semver で運用。
- フェーズ 1 では publish CI 自体は導入せず、Changesets の `init` のみ済ませる。手動 publish は mono 由来の `scripts-common/src/commands/publish-packages.mts` を流用。

## 10. 実装ロードマップ

| フェーズ | スコープ                                                                                                              | 状態         |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| **1**    | scaffold 撤去 → モノレポ化 / `scripts-common` & `packages/v5.7` を webauto から移植 / branded configs 復活 / check-all 通過 | 着手中       |
| **2**    | `packages/v5.8` 以降を増やす。convert-dts に version 差分が出たら hook point を切る。                                 | 未着手       |
| **3**    | `strategies/ts-6-x.mts` 追加。v6.x の lib 差し替えメカニズムに合わせて gen-packages / 利用ドキュメントを分岐。         | 未着手       |
| **4**    | `strategies/ts-le-4-4.mts` 追加。`@typescript/lib-xxx` 非対応時代向け代替メカニズム。                                  | 未着手       |

## 11. 当面のスコープ外

- v5.8 以上、v6 以上、v4.4 以下の対応 (フェーズ 2 以降)
- 公開用 CI (publish workflow) の自動化 (Changesets 初期化のみ実施し、publish は手動から)
- README の利用者向けドキュメント整備 (フェーズ 1 後半か、初回 publish 時点で着手)
