import { defineConfig } from 'vitest/config';

// Coverage gates on the paths users bet production on. Floors sit just under
// today's numbers: raise them when coverage improves, never lower them.
const floor = (lines: number, branches: number) => ({
  lines,
  statements: lines,
  branches,
  functions: lines,
});

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        'src/core.ts': floor(85, 85),
        'src/guardrails.ts': floor(75, 80),
        'src/guardrails/agent.ts': floor(70, 60),
        'src/guardrails/tool-approval.ts': floor(80, 70),
        'src/guardrails/otel.ts': floor(80, 80),
        'src/guardrails/mcp-security.ts': floor(85, 75),
        'src/guardrails/mcp-tool-scan.ts': floor(95, 80),
      },
    },
  },
});
