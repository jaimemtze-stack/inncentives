import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.*',
      '**/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { property: '$queryRawUnsafe', message: 'Use $queryRaw tagged templates (parameterized).' },
        {
          property: '$executeRawUnsafe',
          message: 'Use $executeRaw tagged templates (parameterized).',
        },
      ],
    },
  },
  {
    // Runtime code must not import dev-only packages: they are absent from production images.
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@nestjs/testing', 'vitest', 'supertest', '@playwright/*', '**/test/*'] },
      ],
    },
  },
);
