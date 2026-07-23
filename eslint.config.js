const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Ignore patterns (migrated from .eslintrc.json)
  {
    ignores: [
      'dist/**',
      'out/**',
      'test/support/app.js',
      'app/renderer/src/boot.js',
      'app/renderer/src/bubbles/duplication.js',
    ],
  },
  // Base recommended rules
  js.configs.recommended,
  // Project language options and custom rules
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
