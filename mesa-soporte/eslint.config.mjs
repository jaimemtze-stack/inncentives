import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'infra/**',
      'deploy/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': ['error', { allow: ['error'] }],
      // Raw SQL must go through tagged templates ($queryRaw), never the Unsafe variants.
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use $queryRaw with a tagged template.' },
        { property: '$executeRawUnsafe', message: 'Use $executeRaw with a tagged template.' },
      ],
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/test/**/*.ts',
      '**/e2e/**/*.ts',
      '**/scripts/**/*.ts',
      '**/seed.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
