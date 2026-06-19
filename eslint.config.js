import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'graphify-out', 'scripts', 'public']),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // ── Real errors ──────────────────────────────────────────────────────────
      // Use the TS-aware version of no-unused-vars
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'error',

      // ── R3F false-positives: downgrade to warn ───────────────────────────────
      // These rules fire on legitimate Three.js/R3F patterns (mutating gl, camera,
      // scene in useFrame callbacks). They are not bugs — R3F is designed for it.
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',

      // ── Hook dependency warnings (informational only) ────────────────────────
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]);
