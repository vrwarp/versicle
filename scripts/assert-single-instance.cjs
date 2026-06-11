#!/usr/bin/env node
/**
 * Single-instance assertion for yjs and zustand (Phase 2 vendoring,
 * plan/overhaul/prep/phase2-fork-surgery.md §6.6b).
 *
 * The vendored zustand-middleware-yjs declares yjs and zustand as PEER
 * dependencies, so npm structurally resolves exactly one copy of each at the
 * repo root. Before vendoring they were regular dependencies of the fork and
 * single-instance was dedupe-by-luck: a second nested yjs would break every
 * `instanceof Y.Map` branch inside the middleware and silently corrupt sync
 * (D5-adjacent hazard). This script makes the invariant CI-checkable:
 *
 *   npm run check:single-instance
 *
 * fails unless `npm query '#<name>'` reports exactly one PHYSICAL install of
 * yjs and of zustand in the tree (npm query returns one node per real
 * directory, unlike `npm ls --json`, whose deduped peer-link entries have no
 * stable identity to count). The runtime complement is
 * src/store/__tests__/crdt-contract/single-yjs-instance.test.ts (§6.6d);
 * vite.config.ts / vitest.config.ts `resolve.dedupe` is the belt-and-braces
 * bundler guard (§6.6c).
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const TARGETS = ['yjs', 'zustand'];

let failed = false;
for (const target of TARGETS) {
  const raw = execFileSync('npm', ['query', `#${target}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const nodes = JSON.parse(raw).filter((n) => n.name === target);
  if (nodes.length === 1) {
    console.log(`OK: exactly one physical copy of ${target}: ${nodes[0].version} at ${nodes[0].path}`);
  } else if (nodes.length === 0) {
    console.error(`FAIL: no installed copy of ${target} found — is the dependency tree healthy?`);
    failed = true;
  } else {
    console.error(`FAIL: ${nodes.length} physical copies of ${target}:`);
    for (const n of nodes) console.error(`  - ${n.version} at ${n.path}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
