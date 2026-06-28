import { defineConfig } from 'tsup';

export default defineConfig({
  entryPoints: [
    'src/index.ts',
    'src/guardrails/input.ts',
    'src/guardrails/output.ts',
    'src/guardrails/tools.ts',
    'src/governance/index.ts',
    'src/config/index.ts',
    'src/advanced/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
});
