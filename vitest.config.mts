import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Vite resolves the "@/*" alias from tsconfig.json natively now, so the
    // vite-tsconfig-paths plugin is no longer needed.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'lib/**/*.test.tsx'],
  },
})
