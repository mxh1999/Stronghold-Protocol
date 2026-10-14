import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['var/**'] },
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node }, rules: {
    ...js.configs.recommended.rules,
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  } },
  { files: ['public/*.mjs', 'test/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
