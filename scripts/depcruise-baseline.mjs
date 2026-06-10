#!/usr/bin/env node
/**
 * dependency-cruiser violation baseline — the Phase 0 boundary ratchet
 * (plan/overhaul/README.md §4 rule 3; C12 layering contract).
 *
 * All boundary rules in .dependency-cruiser.cjs are severity "warn"
 * because the repo currently violates them. This script freezes the
 * per-rule violation counts in .dependency-cruiser-baseline.json so the
 * numbers can only go DOWN:
 *
 *   node scripts/depcruise-baseline.mjs           regenerate the baseline
 *                                                 (run after paying down
 *                                                 violations, commit it)
 *   node scripts/depcruise-baseline.mjs --check   exit 1 if any rule's
 *                                                 current count exceeds
 *                                                 its baselined count
 *
 * A rule may be flipped to severity "error" only once its baseline count
 * is 0 (and then its entry here becomes redundant).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = '.dependency-cruiser.cjs';
const baselineFile = join(repoRoot, '.dependency-cruiser-baseline.json');
const checkMode = process.argv.includes('--check');

function currentCounts() {
  // depcruise exits 0 here (all rules are "warn"); JSON goes to stdout.
  const stdout = execFileSync(
    join(repoRoot, 'node_modules', '.bin', 'depcruise'),
    ['src', '--config', configFile, '--output-type', 'json'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);

  // Start every configured rule at 0 so clean rules are pinned at zero.
  const require = createRequire(import.meta.url);
  const config = require(join(repoRoot, configFile));
  const counts = {};
  for (const rule of config.forbidden ?? []) counts[rule.name] = 0;
  for (const violation of result.summary.violations) {
    counts[violation.rule.name] = (counts[violation.rule.name] ?? 0) + 1;
  }
  return counts;
}

const counts = currentCounts();
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (!checkMode) {
  const payload = {
    $comment:
      'Frozen dependency-cruiser violation counts (Phase 0 ratchet). ' +
      'Counts may only decrease. Regenerate with ' +
      '`node scripts/depcruise-baseline.mjs`; enforce with ' +
      '`node scripts/depcruise-baseline.mjs --check`.',
    counts,
    total,
  };
  writeFileSync(baselineFile, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Baseline written to ${baselineFile}`);
  console.table(counts);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
} catch {
  console.error(
    `Missing/unreadable ${baselineFile}. Generate it with ` +
      'node scripts/depcruise-baseline.mjs',
  );
  process.exit(1);
}

let failed = false;
let improved = false;
for (const [rule, count] of Object.entries(counts)) {
  const allowed = baseline.counts?.[rule];
  if (allowed === undefined) {
    console.error(
      `FAIL ${rule}: not in baseline (current: ${count}). ` +
        'New rules must be baselined.',
    );
    failed = true;
  } else if (count > allowed) {
    console.error(`FAIL ${rule}: ${count} violations > baseline ${allowed}`);
    failed = true;
  } else if (count < allowed) {
    console.log(`improved ${rule}: ${count} < baseline ${allowed}`);
    improved = true;
  } else {
    console.log(`ok ${rule}: ${count}`);
  }
}

if (failed) {
  console.error(
    '\nBoundary ratchet violated: new dependency-cruiser violations were ' +
      'introduced. Run `npm run depcruise` to see them. Do not raise the ' +
      'baseline.',
  );
  process.exit(1);
}
if (improved) {
  console.log(
    '\nViolation counts went down — lock it in: ' +
      'node scripts/depcruise-baseline.mjs && commit the baseline.',
  );
}
console.log('Boundary ratchet OK.');
