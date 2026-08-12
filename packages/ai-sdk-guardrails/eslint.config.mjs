import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      // Same family as prevent-abbreviations: renames `i`, `arg`, `props`, …
      'unicorn/name-replacements': 'off',
      // Pure formatting; prettier owns comment layout here.
      'unicorn/single-line-block-comment-style': 'off',
      // Would rename public option/result fields (`passed`, `denied`, `blocked`).
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-nested-ternary': 'off',
      // Reordering `&&`/`||` operands can change short-circuit semantics; the
      // rule itself says to verify each site by hand. Not worth the risk.
      'unicorn/prefer-simple-condition-first': 'off',
      // Cosmetic member ordering.
      'unicorn/consistent-class-member-order': 'off',
      // Module-level memo caches (peer.ts, debug.ts) are deliberate.
      'unicorn/no-top-level-assignment-in-function': 'off',
      // Would force extracting scanner inner loops into functions for no gain.
      'unicorn/no-break-in-nested-loop': 'off',
      'unicorn/max-nested-calls': 'off',
      // `Iterator#toArray()` is ES2025; this package targets lib es2023.
      'unicorn/prefer-iterator-to-array': 'off',
      // `.catch()` tails that map a rejection to a value read better than
      // try/catch around a 50-line combinator body.
      'unicorn/prefer-await': 'off',
      // `_`-prefixed params document a signature slot that isn't used.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // `any` is the point in these files: the public escape-hatch index
    // signatures, and casts in tests.
    files: [
      '**/*.test.ts',
      'src/enhanced-types.ts',
      'src/evaluation/evaluation/types.ts',
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
