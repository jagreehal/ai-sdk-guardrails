#!/usr/bin/env node
// Type-checks every ```ts / ```typescript block in the docs.
// Each block becomes docs/.snippets/<page>-<n>.ts (its own module) and is
// compiled with tsc --noEmit against docs/tsconfig.snippets.json.
// Opt a block out with a `<!-- snippet:skip -->` (or `<!-- snippet:skip: why -->`)
// line directly above its fence.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const contentDir = path.join(docsDir, 'src/content/docs');
const outDir = path.join(docsDir, '.snippets');
const repoDir = path.resolve(docsDir, '..');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Resolve imports in snippets to the workspace: the library itself plus the
// packages the library and the examples already install (ai, @ai-sdk/*, zod...).
const nm = path.join(outDir, 'node_modules');
const link = (target, name) => {
  const dest = path.join(nm, name);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(target, dest, 'junction');
};
link(path.join(repoDir, 'packages/ai-sdk-guardrails'), 'ai-sdk-guardrails');
for (const pkg of ['packages/ai-sdk-guardrails', 'packages/examples']) {
  const dir = path.join(repoDir, pkg, 'node_modules');
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      for (const sub of fs.readdirSync(path.join(dir, name))) {
        link(fs.realpathSync(path.join(dir, name, sub)), `${name}/${sub}`);
      }
    } else {
      link(fs.realpathSync(path.join(dir, name)), name);
    }
  }
}

// The prelude's `import('...')` types must resolve through the links above.
fs.copyFileSync(
  path.join(docsDir, 'scripts/snippet-prelude.d.ts'),
  path.join(outDir, '_prelude.ts'), // .ts, not .d.ts, so skipLibCheck doesn't hide its errors,
);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.mdx?$/.test(e.name) ? [p] : [];
  });

const sources = new Map(); // snippet file name -> { md, line }
let skipped = 0;
for (const md of walk(contentDir).sort()) {
  const rel = path.relative(contentDir, md);
  const page = rel.replace(/\.mdx?$/, '').replaceAll(path.sep, '__');
  const lines = fs.readFileSync(md, 'utf8').split('\n');
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```(ts|typescript)\b/.exec(lines[i]);
    if (!open) continue;
    const indent = open[1].length;
    let end = i + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
    let prev = i - 1;
    while (prev >= 0 && lines[prev].trim() === '') prev--;
    const skip =
      prev >= 0 && lines[prev].trim().startsWith('<!-- snippet:skip');
    const body = lines.slice(i + 1, end).map((l) => l.slice(indent));
    i = end;
    if (skip) {
      skipped++;
      continue;
    }
    const file = `${page}-${++n}.ts`;
    fs.writeFileSync(
      path.join(outDir, file),
      `${body.join('\n')}\nexport {};\n`,
    );
    sources.set(file, {
      md: path.relative(repoDir, md),
      line: i - body.length + 1,
    });
  }
}

const tsc = spawnSync(
  path.join(docsDir, 'node_modules/.bin/tsc'),
  ['--noEmit', '--pretty', 'false', '-p', 'tsconfig.snippets.json'],
  { cwd: docsDir, encoding: 'utf8', shell: process.platform === 'win32' },
);
if (tsc.error) throw tsc.error;

// Point errors at the markdown line instead of the generated file.
const out = `${tsc.stdout}${tsc.stderr}`.replace(
  /^\.snippets[\\/]([^(]+)\((\d+),(\d+)\)/gm,
  (m, file, line, col) => {
    const src = sources.get(file);
    return src
      ? `${src.md}:${src.line + Number(line) - 1}:${col} (${file})`
      : m;
  },
);
process.stdout.write(out);
console.log(`\nchecked ${sources.size} snippets, skipped ${skipped}`);
process.exit(tsc.status ?? 1);
