#!/usr/bin/env node
/**
 * Emitted-artifact purity checks (master plan §2 rules 6 + 9; C12).
 *
 * Four assertions over the production build:
 *  1. WORKER PURITY — the TTS worker chunk closure contains no
 *     zustand/yjs/src-store code (details below).
 *  2. PROD MOCK PURITY (P4-2, phase4-sync-strangler.md §D1) — NO production
 *     chunk contains MockBackend/MockFireProvider. The mock sync backend is
 *     reachable only through the composition root's dynamic import inside an
 *     `import.meta.env.DEV || VITE_E2E` branch (src/app/sync/createSync.ts);
 *     this check is the GATE that the dead branch actually got eliminated
 *     (Rollup inlining surprises — risk R7 — fail here, not in the field).
 *  3. LAZY-LEXICON PURITY (5c-PR3) — bible-lexicon.json stays an async
 *     chunk, out of the entry/worker static closures.
 *  4. ENTRY-CHUNK BUDGET (Phase 8 §A / prep PR-7) — the ENTRY static
 *     closure contains NO firebase/epubjs/GenAI-implementation/reader-
 *     surface sources (content assertion) and its gzip size never
 *     regresses past the recorded baseline + headroom (size ratchet,
 *     bundle-baseline.json).
 *
 * Worker-purity details:
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
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

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
  // The vendored forks (Phase 2/3): since vendoring, their sourcemap paths
  // are packages/<name>/src/*, not node_modules/* — keep them covered by the
  // worker-purity check. y-idb in the worker chunk means a second Y.Doc
  // persistence inside the worker, the data-corruption scenario this script
  // exists to prevent.
  { pattern: 'packages/zustand-middleware-yjs/', label: 'zustand-middleware-yjs (vendored)' },
  { pattern: 'packages/y-idb/', label: 'y-idb (vendored)' },
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

// ── Check 2: prod mock purity (every emitted chunk, not just the worker) ──
// Substring patterns matched against sourcemap `sources` entries.
const MOCK_FORBIDDEN = [
  { pattern: 'src/domains/sync/backend/MockBackend', label: 'MockBackend' },
  { pattern: 'src/domains/sync/backend/MockFireProvider', label: 'MockFireProvider' },
  // Phase 7 (§H, boundary rule 9): the GenAI mock is reachable only via the
  // DEV/VITE_E2E-gated installTestApi() — never from the prod graph.
  { pattern: 'src/domains/google/genai/MockGenAIClient', label: 'MockGenAIClient' },
];

const allChunks = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
const mockViolations = [];
let scannedSources = 0;
for (const chunk of allChunks) {
  const mapPath = join(assetsDir, `${chunk}.map`);
  if (!existsSync(mapPath)) {
    console.error(
      `Missing sourcemap ${chunk}.map — the mock-purity check needs ` +
        'build.sourcemap to stay enabled in vite.config.ts.',
    );
    process.exit(1);
  }
  const { sources = [] } = JSON.parse(readFileSync(mapPath, 'utf8'));
  scannedSources += sources.length;
  for (const rawSource of sources) {
    const source = rawSource.replaceAll('\\', '/');
    for (const { pattern, label } of MOCK_FORBIDDEN) {
      if (source.includes(pattern)) {
        mockViolations.push({ chunk, source: rawSource, label });
      }
    }
  }
}

if (mockViolations.length > 0) {
  console.error(
    `\nFAIL: production bundle contains ${mockViolations.length} mock sync ` +
      'module(s):',
  );
  for (const { chunk, source, label } of mockViolations) {
    console.error(`  [${label}] ${source}  (in ${chunk})`);
  }
  console.error(
    '\nMockBackend/MockFireProvider must only be reachable through the ' +
      'dynamic import in src/app/sync/createSync.ts, inside the ' +
      '`import.meta.env.DEV || VITE_E2E` branch. Find the static import ' +
      'that pulled them into the prod graph (`ANALYZE=true vite build` → ' +
      'stats.html).',
  );
  process.exit(1);
}

console.log(
  `PASS: ${scannedSources} original sources across ${allChunks.length} ` +
    'production chunk(s); no MockBackend / MockFireProvider / MockGenAIClient in the prod bundle.',
);

// ── Check 3: lazy-lexicon purity (Phase 5c-PR3; phase5-tts-strangler.md §5c.3) ──
// The Bible lexicon data (src/lib/tts/bible-lexicon.json, ~85 KB) must reach the
// bundle ONLY through the dynamic import in src/lib/tts/bible-lexicon.ts: it has
// to exist as its own async chunk, and it must NOT be inlined into the main entry
// chunk or the TTS worker entry closure (the eager 2,899-line TS data file this
// replaced sat in the entry graph of both threads).
// JSON chunks carry no sourcemap `sources`, so detect by a DATA MARKER that
// only the Bible lexicon contains (a zh book-name replacement string).
const BIBLE_MARKER = '\u7d04\u7ff0\u4e09\u66f8'; // 約翰三書 (3 John)

const chunksWithBible = [];
for (const chunk of allChunks) {
  const code = readFileSync(join(assetsDir, chunk), 'utf8');
  if (code.includes(BIBLE_MARKER)) {
    chunksWithBible.push(chunk);
  }
}

if (chunksWithBible.length === 0) {
  console.error(
    '\nFAIL: no emitted chunk contains bible-lexicon.json — the lazy loader ' +
      '(src/lib/tts/bible-lexicon.ts) lost its dynamic import target.',
  );
  process.exit(1);
}

/** STATIC-only import closure (dynamic `import(...)` excluded — async chunks are fine). */
function collectStaticClosure(entryFiles) {
  const seen = new Set();
  const queue = [...entryFiles];
  const staticImportRe = /(?:^|[;}\s])(?:import|export)[^("']*?["']((?:\.{1,2}\/)[^"']+\.js)["']/g;
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    // Neutralize dynamic imports so the regex only sees static edges.
    const code = readFileSync(join(assetsDir, file), 'utf8').replace(/import\s*\(/g, 'DYNIMP(');
    for (const match of code.matchAll(staticImportRe)) {
      const resolved = match[1].replace(/^\.\//, '');
      if (!resolved.includes('/') && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

// The REAL entry chunk(s) come from the built index.html script tags —
// post-P8 code splitting, `index-*.js` also matches shared/lazy chunks
// that Rollup named after `index.ts` modules (e.g. domains/google/index),
// so a filename heuristic would scan the wrong graph.
const indexHtml = readFileSync(join(repoRoot, 'dist', 'index.html'), 'utf8');
const entryChunks = [...indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)]
  .map((m) => m[1])
  .filter((f) => existsSync(join(assetsDir, f)));
if (entryChunks.length === 0) {
  console.error('No entry chunk found in dist/index.html — build layout changed?');
  process.exit(1);
}
const eagerHomes = collectStaticClosure([...entryChunks, ...entries]);
const bibleViolations = chunksWithBible.filter((c) => eagerHomes.includes(c));
if (bibleViolations.length > 0) {
  console.error(
    `\nFAIL: bible-lexicon.json was inlined into an EAGER chunk: ${bibleViolations.join(', ')}.\n` +
      'It must only be reachable via the dynamic import in src/lib/tts/bible-lexicon.ts ' +
      '(loadBibleLexicon) so the entry chunk and the worker static closure stay lean. ' +
      'Find the static import that re-eagered it (`ANALYZE=true vite build`).',
  );
  process.exit(1);
}

console.log(
  `PASS: bible-lexicon.json is lazy — emitted only in async chunk(s) ` +
    `${chunksWithBible.join(', ')}; absent from the entry/worker static closures.`,
);

// ── Check 4: entry-chunk budget (Phase 8 §A; phase8-shell-pwa.md PR-7) ──────
// 4a. CONTENT ASSERTION (the durable one): the ENTRY static closure must
//     contain none of the first-use-loaded heavyweights. These moved out of
//     the entry graph via: React.lazy routes (/read/:id → ReaderShell →
//     epubjs), the createSync/composeSync split (firebase loads inside the
//     syncInit boot-task run() body, only when sync is enabled+configured),
//     and the lazy GenAI facade + deep feature imports (GeminiClient and
//     the genai feature modules load on first generate call). If this ever
//     fails, find the static import that re-eagered the chunk
//     (`ANALYZE=true vite build` → stats.html) — do not weaken the list.
// NOTE on epubjs: the kernel CFI shim (src/kernel/cfi/epubcfiShim.ts) is
// SANCTIONED to import the lean `epubjs/src/epubcfi` submodule (it rides
// the entry AND the worker — that was the whole point of the 5c kernel).
// The submodule's closure is epubcfi.js + utils/core.js only, so the
// forbidden markers below name the FULL-ENGINE modules instead of the
// package prefix.
const ENTRY_FORBIDDEN = [
  { pattern: 'node_modules/firebase/', label: 'firebase' },
  { pattern: 'node_modules/@firebase/', label: '@firebase' },
  { pattern: 'node_modules/epubjs/src/epub.js', label: 'epubjs (engine entry)' },
  { pattern: 'node_modules/epubjs/src/book.js', label: 'epubjs (Book)' },
  { pattern: 'node_modules/epubjs/src/rendition.js', label: 'epubjs (Rendition)' },
  { pattern: 'node_modules/epubjs/src/managers/', label: 'epubjs (view managers)' },
  { pattern: 'src/domains/sync/backend/FirestoreBackend', label: 'FirestoreBackend' },
  { pattern: 'src/app/sync/composeSync', label: 'sync composition (heavy half)' },
  { pattern: 'src/domains/google/genai/GeminiClient', label: 'GeminiClient' },
  { pattern: 'src/domains/google/genai/features/', label: 'GenAI feature modules' },
  { pattern: 'src/components/reader/ReaderShell', label: 'ReaderShell (reader surface)' },
];

const entryClosure = collectStaticClosure(entryChunks);
console.log(
  `Entry chunk(s): ${entryChunks.join(', ')} — static closure ` +
    `(${entryClosure.length}): ${entryClosure.join(', ')}`,
);

const entryViolations = [];
let entrySources = 0;
for (const chunk of entryClosure) {
  const mapPath = join(assetsDir, `${chunk}.map`);
  if (!existsSync(mapPath)) {
    console.error(
      `Missing sourcemap ${chunk}.map — the entry-budget check needs ` +
        'build.sourcemap to stay enabled in vite.config.ts.',
    );
    process.exit(1);
  }
  const { sources = [] } = JSON.parse(readFileSync(mapPath, 'utf8'));
  entrySources += sources.length;
  for (const rawSource of sources) {
    const source = rawSource.replaceAll('\\', '/');
    for (const { pattern, label } of ENTRY_FORBIDDEN) {
      if (source.includes(pattern)) {
        entryViolations.push({ chunk, source: rawSource, label });
      }
    }
  }
}

if (entryViolations.length > 0) {
  console.error(
    `\nFAIL: entry static closure contains ${entryViolations.length} ` +
      'first-use module(s) that must stay lazy:',
  );
  for (const { chunk, source, label } of entryViolations.slice(0, 25)) {
    console.error(`  [${label}] ${source}  (in ${chunk})`);
  }
  console.error(
    '\nThe Phase 8 §A code splitting moved these behind dynamic imports ' +
      '(lazy routes, createSync→composeSync, the lazy GenAI facade). A ' +
      'static import somewhere re-eagered them — inspect with ' +
      '`ANALYZE=true vite build` → stats.html.',
  );
  process.exit(1);
}

// 4b. SIZE RATCHET: gzip total of the entry static closure, recorded in
//     bundle-baseline.json (set right after the PR-7 split landed). Allows
//     ~10% headroom; regenerate deliberately with --update-entry-baseline
//     after intentional entry growth/shrink.
const BUNDLE_BASELINE_PATH = join(repoRoot, 'bundle-baseline.json');
const ENTRY_HEADROOM = 1.1;
let entryGzipBytes = 0;
for (const chunk of entryClosure) {
  entryGzipBytes += gzipSync(readFileSync(join(assetsDir, chunk))).length;
}

if (process.argv.includes('--update-entry-baseline')) {
  writeFileSync(
    BUNDLE_BASELINE_PATH,
    `${JSON.stringify({ entryGzipBytes }, null, 2)}\n`,
  );
  console.log(`Entry-budget baseline written: ${entryGzipBytes} gzip bytes.`);
} else if (!existsSync(BUNDLE_BASELINE_PATH)) {
  console.error(
    `\nFAIL: ${BUNDLE_BASELINE_PATH} missing — record the entry budget ` +
      'with `node scripts/check-worker-chunk.mjs --skip-build --update-entry-baseline`.',
  );
  process.exit(1);
} else {
  const { entryGzipBytes: baseline } = JSON.parse(
    readFileSync(BUNDLE_BASELINE_PATH, 'utf8'),
  );
  const limit = Math.round(baseline * ENTRY_HEADROOM);
  if (entryGzipBytes > limit) {
    console.error(
      `\nFAIL: entry static closure is ${entryGzipBytes} gzip bytes — over ` +
        `the budget (baseline ${baseline} + 10% headroom = ${limit}). If the ` +
        'growth is deliberate, regenerate with --update-entry-baseline and ' +
        'justify it in the PR; otherwise find what got eagerly imported.',
    );
    process.exit(1);
  }
  console.log(
    `PASS: entry budget — ${entrySources} original sources across ` +
      `${entryClosure.length} entry chunk(s); no firebase / epubjs / GenAI ` +
      `implementation / ReaderShell; ${entryGzipBytes} gzip bytes ≤ ` +
      `${limit} (baseline ${baseline} + 10%).`,
  );
}

// ── Check 5: PWA shell (Phase 8 §G; phase8-shell-pwa.md PR-8) ───────────────
// The locally-verifiable half of the Lighthouse installability pass:
//  - built index.html links exactly ONE manifest;
//  - the manifest carries the installability fields (id, start_url, scope,
//    display, lang, dir, name, icons 192+512);
//  - the SW is emitted at the root scope (dist/sw.js).
// The interactive halves (offline smoke, two-build update-prompt journey)
// run in the Docker/nightly Playwright lane.
const manifestLinks = [...indexHtml.matchAll(/<link[^>]+rel="manifest"[^>]*>/g)];
if (manifestLinks.length !== 1) {
  console.error(
    `\nFAIL: built index.html has ${manifestLinks.length} manifest links — ` +
      'exactly one expected (single-manifest invariant, Phase 8 §G).',
  );
  process.exit(1);
}
const manifestHref = manifestLinks[0][0].match(/href="([^"]+)"/)?.[1];
const manifestPath = join(repoRoot, 'dist', manifestHref?.replace(/^\//, '') ?? '');
if (!manifestHref || !existsSync(manifestPath)) {
  console.error(`\nFAIL: manifest link href ${manifestHref} not found in dist/.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifestProblems = [];
for (const field of ['id', 'start_url', 'scope', 'display', 'lang', 'dir', 'name', 'short_name']) {
  if (!manifest[field]) manifestProblems.push(`missing '${field}'`);
}
for (const size of ['192x192', '512x512']) {
  if (!manifest.icons?.some((icon) => icon.sizes === size)) {
    manifestProblems.push(`missing ${size} icon`);
  }
}
if (manifestProblems.length > 0) {
  console.error(`\nFAIL: manifest installability fields: ${manifestProblems.join('; ')}.`);
  process.exit(1);
}
if (!existsSync(join(repoRoot, 'dist', 'sw.js'))) {
  console.error('\nFAIL: dist/sw.js missing — the service worker was not emitted.');
  process.exit(1);
}
console.log(
  `PASS: PWA shell — one manifest link (${manifestHref}), installability ` +
    'fields present, sw.js emitted.',
);
