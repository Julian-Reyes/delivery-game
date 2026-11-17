import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The simulation layer and the map data must stay pure: no rendering, physics engine or
    // DOM code.
    files: [
      'src/sim/**/*.ts',
      'src/world/layout.ts',
      'src/world/random.ts',
      'src/world/terrain.ts',
      'src/world/roads/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', '@dimforge/*'],
              message:
                'This is pure game logic or map data. Keep rendering and physics imports out of it.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document'],
    },
  },
);
