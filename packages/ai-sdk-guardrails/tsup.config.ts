import { defineConfig } from 'tsup';

export default defineConfig({
  entryPoints: [
    'src/index.ts',
    'src/guardrails/input.ts',
    'src/guardrails/output.ts',
    'src/guardrails/tools.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
});
