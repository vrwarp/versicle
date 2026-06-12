#!/usr/bin/env node
/**
 * CSP generator (Phase 7 §I) — renders the Content-Security-Policy from the
 * egress destination registry (src/kernel/net/destinations.ts via
 * src/kernel/net/csp.ts) and rewrites every committed copy:
 *
 *   node scripts/generate-csp.mjs          rewrite nginx.conf in place
 *   node scripts/generate-csp.mjs --check  exit 1 if nginx.conf is stale
 *
 * nginx.conf is the only COMMITTED output: the vite preview headers and the
 * build-time index.html meta tag import renderCsp() directly from
 * vite.config.ts, so they can never drift. The registry==CSP unit test
 * (src/kernel/net/csp.test.ts) additionally pins the committed nginx.conf
 * against renderCsp() on every vitest run — CI fails before this script is
 * ever needed.
 *
 * Node >= 25 (package.json engines) strips types natively, so importing the
 * .ts modules below needs no build step. They are import-free pure data by
 * contract (see destinations.ts header).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { renderCsp } = await import(
  new URL('../src/kernel/net/csp.ts', import.meta.url).href
);

const checkMode = process.argv.includes('--check');
const policy = renderCsp();

const nginxPath = join(repoRoot, 'nginx.conf');
const current = readFileSync(nginxPath, 'utf8');
const cspLine = `add_header Content-Security-Policy "${policy}";`;
const next = current.replace(
  /add_header Content-Security-Policy "[^"]*";/g,
  cspLine,
);

if (!next.includes(cspLine)) {
  console.error(
    'generate-csp: no `add_header Content-Security-Policy` line found in nginx.conf — template drifted.',
  );
  process.exit(1);
}

if (checkMode) {
  if (next !== current) {
    console.error(
      'generate-csp --check: nginx.conf CSP is stale. Run `node scripts/generate-csp.mjs` and commit.',
    );
    process.exit(1);
  }
  console.log('generate-csp --check: nginx.conf CSP matches the registry.');
} else if (next === current) {
  console.log('generate-csp: nginx.conf already up to date.');
} else {
  writeFileSync(nginxPath, next);
  console.log('generate-csp: nginx.conf CSP regenerated from the registry.');
}
