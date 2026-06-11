#!/usr/bin/env node
/**
 * Worker-chunk purity check (master plan §2 rule 6; C12 contract).
 *
 * The TTS worker must never bundle zustand, yjs, or src/store/ modules:
 * a second Y.Doc + IndexedDB persistence inside the worker is the
 * data-corruption scenario src/app/repositories/BookRepository.ts's docstring warns
 * about. The source-level guards are `import type` discipline
 * (@typescript-eslint/consistent-type-imports, error) and the
 * dependency-cruiser ruleset — but with verbatimModuleSyntax on, one
 * missing `type` keyword silently pulls real store code into the worker
 * bundle. This script asserts the EMITTED ARTIFACT, the ground truth:
 *
 *   1. runs a production build (`vite build`; skip with --skip-build to
 *      scan an existing dist/),
 *   2. finds the TTS worker entry chunk(s) in dist/assets/,
 *   3. walks their static + dynamic import closure across emitted chunks,
 *   4. reads each chunk's sourcemap and fails if any original source is
 *      zustand, yjs, or src/store/.
 *
 * Usage:  npm run check:worker-chunk          (build + scan)
 *         node scripts/check-worker-chunk.mjs --skip-build
 *
 * Expected state: PASS with zero forbidden sources. If this ever fails,
 * do not weaken this script — find the value-import that leaked state
 * into the worker graph (`ANALYZE=true vite build` renders per-module
 * treemaps to stats-worker.html for spelunking).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(repoRoot, 'dist', 'assets');
const skipBuild = process.argv.includes('--skip-build');

const WORKER_ENTRY_RE = /^tts\.worker-[\w-]+\.js$/;
// Substring patterns matched against sourcemap `sources` entries
// (paths are relative to dist/assets/, e.g. "../../src/store/x.ts").
const FORBIDDEN = [
  { pattern: 'node_modules/zustand', label: 'zustand (incl. zustand-middleware-yjs)' },
  { pattern: 'node_modules/yjs/', label: 'yjs' },
  { pattern: 'src/store/', label: 'src/store' },
];

if (!skipBuild) {
  console.log('Building production bundle (vite build)…');
  execFileSync(join(repoRoot, 'node_modules', '.bin', 'vite'), ['build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

if (!existsSync(assetsDir)) {
  console.error(`No ${assetsDir} — run without --skip-build.`);
  process.exit(1);
}

const entries = readdirSync(assetsDir).filter((f) => WORKER_ENTRY_RE.test(f));
if (entries.length === 0) {
  console.error(
    'No TTS worker entry chunk (tts.worker-*.js) found in dist/assets. ' +
      'If the worker entry was renamed, update WORKER_ENTRY_RE in ' +
      'scripts/check-worker-chunk.mjs — this check must keep covering it.',
  );
  process.exit(1);
}

/** Walk static+dynamic relative imports from the entry chunks. */
function collectChunkClosure(entryFiles) {
  const seen = new Set();
  const queue = [...entryFiles];
  const importRe = /(?:from|import)\s*\(?\s*["']((?:\.{1,2}\/)[^"']+\.js)["']\)?/g;
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(join(assetsDir, file), 'utf8');
    for (const match of code.matchAll(importRe)) {
      const resolved = match[1].replace(/^\.\//, '');
      if (!resolved.includes('/') && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

const closure = collectChunkClosure(entries);
console.log(`TTS worker entry chunk(s): ${entries.join(', ')}`);
console.log(`Chunk closure (${closure.length}): ${closure.join(', ')}`);

const violations = [];
let totalSources = 0;
for (const chunk of closure) {
  const mapPath = join(assetsDir, `${chunk}.map`);
  if (!existsSync(mapPath)) {
    console.error(
      `Missing sourcemap ${chunk}.map — the check needs build.sourcemap ` +
        'to stay enabled in vite.config.ts.',
    );
    process.exit(1);
  }
  const { sources = [] } = JSON.parse(readFileSync(mapPath, 'utf8'));
  totalSources += sources.length;
  for (const rawSource of sources) {
    const source = rawSource.replaceAll('\\', '/');
    for (const { pattern, label } of FORBIDDEN) {
      if (source.includes(pattern)) {
        violations.push({ chunk, source: rawSource, label });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\nFAIL: worker chunk closure contains ${violations.length} forbidden ` +
      'module(s):',
  );
  for (const { chunk, source, label } of violations) {
    console.error(`  [${label}] ${source}  (in ${chunk})`);
  }
  console.error(
    '\nState management must not enter the TTS worker. Look for a type ' +
      'import that became a value import (consistent-type-imports), then ' +
      'inspect with `ANALYZE=true vite build` → stats-worker.html.',
  );
  process.exit(1);
}

console.log(
  `PASS: ${totalSources} original sources across ${closure.length} ` +
    'chunk(s); no zustand / yjs / src/store in the TTS worker closure.',
);
