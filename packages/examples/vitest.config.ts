import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests use real LLMs and may be flaky
    // They're not meant for CI/CD but for manual verification
    globals: true,
    environment: 'node',
    // Increase timeout for LLM calls
    testTimeout: 60000,
    // Don't fail on console errors (examples may log warnings)
    onConsoleLog: () => true,
  },
});

