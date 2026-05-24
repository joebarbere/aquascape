// Workspace-root ESLint flat config. Defines the layering enforcement that
// every project inherits via `eslint.config.cjs` files that extend this one.
const nx = require('@nx/eslint-plugin');

module.exports = [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/coverage', '**/.nx', 'node_modules', '**/build'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // The architecture lock. Plan §2.2.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            // type:lib vs type:app
            {
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib', 'type:app'],
            },

            // scope:domain — may depend on scope:domain only. No frameworks.
            {
              sourceTag: 'scope:domain',
              onlyDependOnLibsWithTags: ['scope:domain'],
            },

            // scope:rendering — may depend on scope:domain (scene-model + geometry)
            {
              sourceTag: 'scope:rendering',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:rendering'],
            },

            // scope:feature — may depend on domain, rendering, ui, state, platform-api
            // NOT on a concrete platform implementation.
            {
              sourceTag: 'scope:feature',
              onlyDependOnLibsWithTags: [
                'scope:domain',
                'scope:rendering',
                'scope:ui',
                'scope:state',
                'scope:platform-api',
                'scope:feature',
                'scope:testing',
              ],
            },

            // scope:ui — presentational components. May use domain for types/geometry only.
            {
              sourceTag: 'scope:ui',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:ui'],
            },

            // scope:state — NgRx stores. May depend on domain + platform-api.
            {
              sourceTag: 'scope:state',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform-api', 'scope:state'],
            },

            // scope:platform-api — interface only.
            {
              sourceTag: 'scope:platform-api',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform-api'],
            },

            // scope:platform-web / scope:platform-electron — implementations.
            // Only apps may import these (enforced from the *consumer* side: apps
            // have scope:app and may depend on platform-* tags; features explicitly
            // omit them from their allow-list above).
            {
              sourceTag: 'scope:platform-web',
              onlyDependOnLibsWithTags: [
                'scope:domain',
                'scope:platform-api',
                'scope:platform-web',
              ],
            },
            {
              sourceTag: 'scope:platform-electron',
              onlyDependOnLibsWithTags: [
                'scope:domain',
                'scope:platform-api',
                'scope:platform-electron',
              ],
            },

            // scope:app — composes everything.
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: [
                'scope:domain',
                'scope:rendering',
                'scope:feature',
                'scope:ui',
                'scope:state',
                'scope:platform-api',
                'scope:platform-web',
                'scope:platform-electron',
                'scope:testing',
              ],
            },

            // scope:testing — fixtures + harnesses. May see domain shapes only.
            {
              sourceTag: 'scope:testing',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:testing'],
            },

            // framework:none guards framework-free libs from accidental Angular pull-in
            {
              sourceTag: 'framework:none',
              onlyDependOnLibsWithTags: ['framework:none'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/jest.config.ts', '**/jest.config.js'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
