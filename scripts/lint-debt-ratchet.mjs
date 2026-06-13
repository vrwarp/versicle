#!/usr/bin/env node
/**
 * Lint-debt ratchet (P9; plan/overhaul/README.md §4 rule 3):
 * production `any` usage (`as any` / `: any`) and eslint-disable directives
 * may ONLY decrease. The original Phase 0 baseline was 138 `as any` sites and
 * 245 disables; P9 drove every mechanically-fixable one to zero and froze the
 * irreducible rest — each with a justification — in lint-debt-allowlist.json.
 *
 *   check:   node scripts/lint-debt-ratchet.mjs --check   (CI gate)
 *   update:  node scripts/lint-debt-ratchet.mjs --update  (lock in a decrease)
 *
 * Rules enforced by --check:
 *   - a production file with `any`/disable counts and NO allowlist entry fails;
 *   - counts above an entry fail (regression);
 *   - counts below an entry fail too ("ratchet down"): run --update so the
 *     improvement is locked in and cannot quietly creep back.
 * --update only ever LOWERS counts (or drops empty entries); raising a count
 * or adding a new file requires a hand-written entry with a `reason`.
 *
 * Scope: first-party production code = src✱✱/*.{ts,tsx} minus tests
 * (*.test.*, *.spec.*, src/test/, __tests__/, __fixtures__/) and ambient
 * *.d.ts. The vendored forks (packages/✱/src) are exempt by the same policy
 * as the eslint ignore block: they stay diff-minimal against upstream.
 *
 * Counting: `as any` / `: any` are counted on comment- and string-stripped
 * source (a doc-comment mentioning `as any` is not debt); eslint-disable
 * DIRECTIVES are counted as comments that *start* with `eslint-disable`
 * (prose mentioning the word is not a directive).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowlistFile = join(root, 'lint-debt-allowlist.json');

const TEST_PATTERNS = [/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /\/__tests__\//, /\/__fixtures__\//, /^src\/test\//];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function productionFiles() {
  const files = [];
  for (const full of walk(join(root, 'src'))) {
    const rel = relative(root, full).replaceAll('\\', '/');
    if (!/\.(ts|tsx)$/.test(rel)) continue;
    if (rel.endsWith('.d.ts')) continue;
    if (TEST_PATTERNS.some((p) => p.test(rel))) continue;
    files.push(rel);
  }
  return files.sort();
}

/**
 * Strip comments and string/template literals, preserving newlines so any
 * future line reporting stays accurate. Good-enough lexer for a counter:
 * handles // and block comments, '"`' strings with escapes, and template
 * literals (interpolations are kept as code).
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | line | block | squote | dquote | template
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") { mode = 'squote'; i++; continue; }
      if (c === '"') { mode = 'dquote'; i++; continue; }
      if (c === '`') { mode = 'template'; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } i++; continue; }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; }
      if (c === '\n') out += '\n';
      i++; continue;
    }
    // strings
    if (c === '\\') { i += 2; continue; }
    if (mode === 'squote' && c === "'") { mode = 'code'; i++; continue; }
    if (mode === 'dquote' && c === '"') { mode = 'code'; i++; continue; }
    if (mode === 'template') {
      if (c === '`') { mode = 'code'; i++; continue; }
      if (c === '$' && next === '{') {
        // keep interpolation as code until the matching close brace (shallow)
        let depth = 1; i += 2; out += ' ';
        while (i < n && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          else out += src[i] === '\n' ? '\n' : src[i];
          i++;
        }
        continue;
      }
      if (c === '\n') out += '\n';
      i++; continue;
    }
    if (c === '\n') out += '\n';
    i++;
  }
  return out;
}

function countFile(rel) {
  const src = readFileSync(join(root, rel), 'utf8');
  const code = stripCommentsAndStrings(src);
  const asAny = (code.match(/\bas any\b/g) ?? []).length;
  const colonAny = (code.match(/:\s*any\b/g) ?? []).length;
  // Directives are comments that START with eslint-disable.
  const disables = (src.match(/(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b/g) ?? []).length;
  return { asAny, colonAny, disables };
}

function scan() {
  const perFile = new Map();
  for (const rel of productionFiles()) {
    const counts = countFile(rel);
    if (counts.asAny || counts.colonAny || counts.disables) perFile.set(rel, counts);
  }
  return perFile;
}

function loadAllowlist() {
  return JSON.parse(readFileSync(allowlistFile, 'utf8'));
}

function totals(perFile) {
  const t = { asAny: 0, colonAny: 0, disables: 0 };
  for (const c of perFile.values()) { t.asAny += c.asAny; t.colonAny += c.colonAny; t.disables += c.disables; }
  return t;
}

const mode = process.argv.includes('--update') ? 'update' : 'check';
const perFile = scan();
const allowlist = loadAllowlist();
const entries = allowlist.files ?? {};
const failures = [];
const improvements = [];

for (const [file, counts] of perFile) {
  const entry = entries[file];
  if (!entry) {
    failures.push(`${file}: ${counts.asAny} as-any / ${counts.colonAny} colon-any / ${counts.disables} disables, but NO allowlist entry — fix the code or add a justified entry to lint-debt-allowlist.json`);
    continue;
  }
  for (const key of ['asAny', 'colonAny', 'disables']) {
    if (counts[key] > (entry[key] ?? 0)) {
      failures.push(`${file}: ${key} regressed (${counts[key]} > allowlisted ${entry[key] ?? 0})`);
    } else if (counts[key] < (entry[key] ?? 0)) {
      improvements.push({ file, key, actual: counts[key], allowed: entry[key] ?? 0 });
    }
  }
}
for (const file of Object.keys(entries)) {
  if (!perFile.has(file)) improvements.push({ file, key: 'all', actual: 0, allowed: '(entry now empty)' });
}

if (mode === 'update') {
  let changed = false;
  for (const [file, entry] of Object.entries(entries)) {
    const counts = perFile.get(file);
    if (!counts) { delete entries[file]; changed = true; continue; }
    for (const key of ['asAny', 'colonAny', 'disables']) {
      const actual = counts[key];
      if (actual < (entry[key] ?? 0)) { entry[key] = actual; changed = true; }
    }
  }
  if (changed) {
    writeFileSync(allowlistFile, JSON.stringify(allowlist, null, 2) + '\n');
    console.log('lint-debt-allowlist.json ratcheted DOWN. New entries must be added by hand with a reason.');
  } else {
    console.log('Allowlist already tight.');
  }
}

const t = totals(perFile);
console.log(`Production lint debt: ${t.asAny} as-any + ${t.colonAny} colon-any (${t.asAny + t.colonAny} any-sites; Phase 0 baseline 138) / ${t.disables} eslint-disable directives (baseline 245) across ${perFile.size} files.`);

if (mode === 'check') {
  if (failures.length) {
    console.error('\nLint-debt ratchet FAILED:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  if (improvements.length) {
    console.error('\nLint-debt ratchet: counts DECREASED — lock it in:');
    for (const i of improvements) console.error(`  - ${i.file}: ${i.key} ${i.actual} < ${i.allowed}`);
    console.error('Run `node scripts/lint-debt-ratchet.mjs --update` and commit the allowlist.');
    process.exit(1);
  }
  console.log('Lint-debt ratchet OK.');
}
