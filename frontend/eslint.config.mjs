import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'contracts/**',
      'src/types/api.d.ts',
      'next-env.d.ts',
      'pnpm-lock.yaml',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // TypeScript — the strictness that tsconfig alone cannot express.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Core correctness.
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'properties'],
      'no-debugger': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // App Router only — the Pages Router router must never be imported.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/router',
              message: 'Use next/navigation — this project is App Router only.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests and test infrastructure may assert hard and log freely.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'vitest.setup.ts',
      'src/mocks/**/*.ts',
      'src/lib/testing/**/*.tsx',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];

export default eslintConfig;
