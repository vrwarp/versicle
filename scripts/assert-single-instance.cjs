#!/usr/bin/env node
/**
 * Single-instance assertion for yjs, zustand, lib0, and the firebase SDK
 * (Phase 2 vendoring, plan/overhaul/prep/phase2-fork-surgery.md §6.6b;
 * extended for the Phase 3 y-idb vendoring, phase3-storage-gateway.md §D6;
 * extended again for the Phase 9 y-cinder vendoring,
 * phase4-sync-strangler.md §D6).
 *
 * The vendored forks declare their shared runtime deps as PEER dependencies
 * (zustand-middleware-yjs → yjs + zustand; y-idb → yjs + lib0; y-cinder →
 * firebase + yjs + lib0), so npm structurally resolves exactly one copy of
 * each at the repo root. Before vendoring they were regular dependencies of
 * the forks and single-instance was dedupe-by-luck: a second nested yjs
 * would break every `instanceof Y.Map` branch inside the middleware and
 * silently corrupt sync (D5-adjacent hazard); a second lib0 would split
 * y-idb's Observable base from yjs's own lib0; a second @firebase/app would
 * split y-cinder's Firestore handle from the app's auth session (the
 * provider resolves Firestore FROM the FirebaseApp instance the backend
 * passes it). This script makes the invariant CI-checkable:
 *
 *   npm run check:single-instance
 *
 * fails unless `npm query '#<name>'` reports exactly one PHYSICAL install of
 * each target in the tree (npm query returns one node per real directory,
 * unlike `npm ls --json`, whose deduped peer-link entries have no stable
 * identity to count). The runtime complement is
 * src/store/__tests__/crdt-contract/single-yjs-instance.test.ts (§6.6d);
 * vite.config.ts / vitest.config.ts `resolve.dedupe` is the belt-and-braces
 * bundler guard (§6.6c).
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const TARGETS = [
  'yjs',
  'zustand',
  'lib0',
  // The umbrella SDK plus the three scoped packages the vendored y-cinder
  // source imports directly (@firebase/app|firestore|storage): exactly one
  // physical copy of each, or FirebaseApp identity splits between the
  // backend and the provider.
  'firebase',
  '@firebase/app',
  '@firebase/firestore',
  '@firebase/storage',
];

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
