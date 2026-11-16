import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build also works from file-like hosts (Capacitor, Electron) later.
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
