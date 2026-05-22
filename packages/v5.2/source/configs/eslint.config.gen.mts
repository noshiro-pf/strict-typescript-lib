import {
  defineKnownRules,
  eslintConfigForTypeScriptWithoutRules,
  withDefaultOption,
  type FlatConfig,
} from 'eslint-config-typed';

const thisDir = import.meta.dirname;

export default [
  {
    ignores: ['eslint.config.mts', 'eslint.config.*.mjs'],
  },
  ...eslintConfigForTypeScriptWithoutRules({
    tsconfigRootDir: thisDir,
    tsconfigFileName: './tsconfig.eslint.json',
  }),

  {
    files: ['temp/eslint-fixed/**/*.d.ts'],

    rules: defineKnownRules({
      'prefer-const': withDefaultOption('error'),
      '@typescript-eslint/no-explicit-any': [
        'error',
        {
          fixToUnknown: true,
          ignoreRestArgs: true,
        },
      ],
    }),
  },
  {
    files: ['temp/eslint-fixed/**/!(lib.dom|lib.webworker).d.ts'],

    rules: {
      // https://github.com/jonaskello/eslint-plugin-functional/blob/master/docs/rules/prefer-readonly-type.md
      'functional/prefer-readonly-type': [
        'error',
        {
          checkImplicit: false,
          ignoreInterface: false,
          ignoreCollections: false,
          ignoreClass: 'fieldsOnly',
          allowMutableReturnType: true,
          allowLocalMutation: false,
          ignorePattern: [],
        },
      ],
    },
  },
] as const satisfies readonly FlatConfig[];
