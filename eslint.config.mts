import {
  defineKnownRules,
  eslintConfigForNodeJs,
  eslintConfigForTypeScript,
  type FlatConfig,
} from 'eslint-config-typed';
import { eslintPluginTsDataForge } from 'eslint-plugin-ts-data-forge';
import { eslintPluginTsFortress } from 'eslint-plugin-ts-fortress';
import { eslintPluginTsTypeForge } from 'eslint-plugin-ts-type-forge';

const repoRoot = import.meta.dirname;

/**
 * Rule overrides shared by all build-tooling / source files in this repository
 * (root scripts & configs, per-version generators, the shared generator
 * library). Individual `files`-scoped blocks below layer more on top.
 */
const commonNodeRuleOverrides = defineKnownRules({
  '@typescript-eslint/explicit-function-return-type': 'off',
  'no-await-in-loop': 'off',
  'import-x/no-unassigned-import': 'off',
  'import-x/no-internal-modules': 'off',
  'import-x/no-default-export': 'off',
  'import-x/no-extraneous-dependencies': 'off',
  'security/detect-non-literal-fs-filename': 'off',
});

/**
 * Every build-tooling source path across the monorepo. The workspaces are
 * homogeneous (each `packages/vX.Y` only differs by the pinned TypeScript
 * version), so this single root config lints them all; there is no per-workspace
 * `eslint.config.mts`.
 */
const toolingFiles = [
  'scripts/**',
  'configs/**',
  'eslint.config.mts',
  'packages/scripts-common/src/**',
  'packages/*/scripts/**',
] as const;

/**
 * The single flat ESLint config for the whole repository.
 *
 * Typed linting resolves against `tsconfig.tooling.json`, which includes all of
 * {@link toolingFiles} and uses the stock lib — so there is no per-workspace
 * `tsconfig.json`. The generated strict lib is validated separately via each
 * `packages/vX.Y/tsconfig.lib-check*.json`.
 */
const config: readonly FlatConfig[] = [
  {
    ignores: [
      '**/temp/**',
      '**/output/**',
      '**/output-branded/**',
      'packages/*/output*/**',
      // External common-agent-config submodule; not part of this repo's tooling.
      'agents/**',
    ],
  },
  ...eslintConfigForTypeScript({
    tsconfigRootDir: repoRoot,
    tsconfigFileName: 'tsconfig.tooling.json',
    packageDirs: [repoRoot],
  }),

  eslintPluginTsTypeForge.configs.recommended,
  eslintPluginTsDataForge.configs.recommended,
  eslintPluginTsFortress.configs.recommended,

  eslintConfigForNodeJs(toolingFiles),
  {
    files: toolingFiles,
    rules: defineKnownRules(commonNodeRuleOverrides),
  },
  {
    // Root build tooling operates on trusted, repo-local paths.
    files: ['scripts/**', 'configs/**', 'eslint.config.mts'],
    rules: defineKnownRules({
      'functional/immutable-data': 'off',
    }),
  },
  {
    // Per-version generator entry points (thin wrappers over scripts-common).
    files: ['packages/*/scripts/**'],
    rules: defineKnownRules({
      'total-functions/no-unsafe-type-assertion': 'off',
    }),
  },
  {
    // Shared generator library: imperative code operating on trusted paths.
    files: ['packages/scripts-common/src/**'],
    rules: defineKnownRules({
      '@typescript-eslint/prefer-readonly-parameter-types': 'off',
      'import-x/first': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-child-process': 'off',
      'no-restricted-syntax': 'off',
      'functional/immutable-data': 'off',
      'functional/no-let': 'off',
      'functional/no-loop-statements': 'off',
      'functional/no-throw-statements': 'off',
      'functional/no-conditional-statements': 'off',
      'functional/no-expression-statements': 'off',
      'functional/no-return-void': 'off',
      'total-functions/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-restricted-types': 'off',
      'no-template-curly-in-string': 'off',
    }),
  },
] as const;

export default config;
