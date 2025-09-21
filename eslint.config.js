import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  // Base ESLint recommended rules
  js.configs.recommended,

  // TypeScript configuration
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // TypeScript-specific rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // API/Library specific rules
      'no-console': 'off', // Allow console for debugging and logging

      // General code quality
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-throw-literal': 'error',

      // Error handling
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],

      // Security-focused rules for libraries
      'no-script-url': 'error',
      'no-new-wrappers': 'error',

      // Performance
      'no-loop-func': 'error',

      // Formatting (basic) - Note: If using Prettier, consider removing these
      semi: ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],

      // Line length for readability
      'max-len': [
        'warn',
        {
          code: 120,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreComments: true,
        },
      ],

      // Function complexity for maintainability
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
    },
  },

  // Test files configuration
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // Test files may need any types
      complexity: 'off', // Test functions can be more complex
      'max-len': 'off', // Test descriptions can be long
    },
  },

  // Example files configuration
  {
    files: ['examples/**/*.ts'],
    rules: {
      'no-console': 'off', // Examples often demonstrate with console output
      '@typescript-eslint/no-explicit-any': 'off', // Examples may use any for simplicity
      complexity: 'off', // Examples may be more complex for demonstration
    },
  },

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/*.js.map',
      '**/*.d.ts',
      '.changeset/**',
    ],
  },
];

// Note: This configuration is designed for TypeScript libraries and API projects
// The target project already has eslint.config.mjs with prettier and unicorn plugins
// Consider using that configuration instead, or merging the best practices from both
