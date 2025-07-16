import { execSync } from 'node:child_process';
import path from 'node:path';

const examples = [
  'basic-guardrails.ts',
  'object-guardrails.ts',
  'streaming-guardrails.ts',
  'rate-limit-guardrail.ts',
  'autoevals-guardrails.ts',
];

async function runExample(exampleFile: string) {
  console.log(`\n🚀 Running ${exampleFile}...`);
  console.log('='.repeat(50));

  try {
    execSync(`tsx ${path.join(import.meta.dirname || '.', exampleFile)}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log(`✅ ${exampleFile} completed successfully\n`);
  } catch (error) {
    console.error(`❌ ${exampleFile} failed:`, error);
    throw error;
  }
}

async function main() {
  console.log('🛡️  AI SDK Guardrails - All Examples');
  console.log('=====================================');
  console.log(`Running ${examples.length} example files...`);

  for (const example of examples) {
    await runExample(example);
  }

  console.log('🎉 All examples completed successfully!');
}

main().catch(console.error);
