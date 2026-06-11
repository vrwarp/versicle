#!/usr/bin/env node
/**
 * Path-alias codemod (Phase 1, plan/overhaul/README.md §Roadmap P1a).
 *
 * Rewrites cross-root relative imports under src/ to the path aliases
 * declared in tsconfig.app.json `paths` (and mirrored in vite.config.ts /
 * vitest.config.ts resolve.alias):
 *
 *   ../(../)*<root>/rest  ->  @<root>/rest
 *   for root in: app components db hooks lib store types test workers
 *   (types maps to ~types, NOT @types: TypeScript rejects any import
 *   specifier starting with '@types/' — error TS6137, the prefix is
 *   reserved for declaration packages.)
 *
 * Rules (matching the eslint no-restricted-imports guard in
 * eslint.config.js — running this script must leave the repo clean
 * against that rule):
 *   - A `../` specifier is rewritten when its RESOLVED target is an
 *     existing module under an aliased root and either (a) the importer
 *     lives outside that root (cross-root), or (b) the specifier names a
 *     root after the `../` climb (e.g. `../../lib/x` from inside lib/ —
 *     the lint regex bans the spelling, so it is normalized too). The
 *     resolved target decides the alias, so non-canonical spellings like
 *     `../lib/tts/../../db/DBService` become `@db/DBService`.
 *   - Same-directory (`./foo`) and within-subtree relative imports stay
 *     relative by design.
 *   - Specifiers that name a root but do not resolve to an existing
 *     module (e.g. a vi.mock of a path that never existed) are LEFT
 *     UNTOUCHED and reported: rewriting a dead mock to a live alias
 *     would silently activate it — a behavior change.
 *   - Vite query suffixes (?worker, ?url, ?raw, ...) are preserved.
 *   - `new URL('...', import.meta.url)` string arguments are NOT
 *     rewritten: they are not import statements; the two
 *     `new Worker(new URL('../workers/…'))` sites stay relative.
 *
 * Rewritten specifier positions:
 *   - static import / export ... from declarations
 *   - dynamic import('...') calls
 *   - inline `import('...')` type annotations (ImportType nodes)
 *   - vitest module-mock calls: vi.mock / vi.doMock / vi.unmock /
 *     vi.doUnmock / vi.importActual / vi.importMock (vitest keys mocks on
 *     resolver-normalized ids, so alias and relative forms are
 *     interchangeable — rewriting keeps the repo on one canonical form).
 *
 * Usage:
 *   node scripts/codemod-aliases.mjs            rewrite in place + summary
 *   node scripts/codemod-aliases.mjs --dry      report only, write nothing
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'src');
const dry = process.argv.includes('--dry');

/** Aliased top-level src/ roots. Keep in sync with tsconfig.app.json. */
const ROOTS = [
  'app',
  'components',
  'db',
  'hooks',
  'lib',
  'store',
  'types',
  'test',
  'workers',
];
const ROOT_SET = new Set(ROOTS);
/** types/ cannot be '@types/…' (TS6137); everything else is '@<root>'. */
const aliasFor = (root) => (root === 'types' ? '~types' : `@${root}`);
const CROSS_ROOT_RE = new RegExp(
  `^(\\.\\./)+(${ROOTS.join('|')})(/|$)`,
);
const MOCK_CALLEES = new Set([
  'vi.mock',
  'vi.doMock',
  'vi.unmock',
  'vi.doUnmock',
  'vi.importActual',
  'vi.importMock',
]);

/** Recursively collect .ts/.tsx files under dir. */
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The aliased src/ root containing `absPath`, or null. */
function rootOf(absPath) {
  const rel = path.relative(srcRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const first = rel.split(path.sep)[0];
  return ROOT_SET.has(first) ? first : null;
}

/** Does `absPath` (extensionless or not) point at an existing module? */
function moduleExists(absPath) {
  return [
    absPath, // explicit extension (.ts via allowImportingTsExtensions, assets)
    `${absPath}.ts`,
    `${absPath}.tsx`,
    `${absPath}.d.ts`,
    path.join(absPath, 'index.ts'),
    path.join(absPath, 'index.tsx'),
  ].some((candidate) => existsSync(candidate));
}

/**
 * If `spec` is a cross-root relative specifier from `fileDir`, return the
 * alias rewrite; otherwise null. Specifiers that name a root but do not
 * resolve to an existing module are pushed to `anomalies` and skipped.
 */
function rewriteSpec(spec, fileDir, anomalies, context) {
  if (!spec.startsWith('../')) return null;
  const queryIdx = spec.search(/[?#]/);
  const bare = queryIdx === -1 ? spec : spec.slice(0, queryIdx);
  const query = queryIdx === -1 ? '' : spec.slice(queryIdx);
  const resolved = path.resolve(fileDir, bare);
  const targetRoot = rootOf(resolved);
  const namesRoot = CROSS_ROOT_RE.test(spec);
  if (!targetRoot || !moduleExists(resolved)) {
    if (namesRoot) {
      // Names an aliased root but resolves nowhere (dead vi.mock path) or
      // outside src/. Leave it alone and surface it for a human.
      anomalies.push({ context, spec, resolved: path.relative(repoRoot, resolved) });
    }
    return null;
  }
  const importerRoot = rootOf(fileDir);
  // Within-subtree relative imports stay relative — unless the spelling
  // re-enters the root by name (banned by the lint regex).
  if (targetRoot === importerRoot && !namesRoot) return null;
  const rel = path.relative(path.join(srcRoot, targetRoot), resolved);
  if (rel === '') {
    // Bare root-directory import — no wildcard mapping covers it.
    anomalies.push({ context, spec, resolved: path.relative(repoRoot, resolved) });
    return null;
  }
  return {
    newSpec: `${aliasFor(targetRoot)}/${rel.split(path.sep).join('/')}${query}`,
    root: targetRoot,
  };
}

/** Collect every module-specifier string literal node we rewrite. */
function collectSpecifierNodes(sourceFile) {
  const nodes = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      nodes.push(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      nodes.push(node.arguments[0]);
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        nodes.push(arg.literal);
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MOCK_CALLEES.has(node.expression.getText(sourceFile)) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      nodes.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
}

const counts = Object.fromEntries(ROOTS.map((r) => [aliasFor(r), 0]));
const anomalies = [];
let filesChanged = 0;
let totalRewrites = 0;

for (const file of collectFiles(srcRoot)) {
  const text = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const fileDir = path.dirname(file);
  const relFile = path.relative(repoRoot, file);

  const edits = [];
  for (const literal of collectSpecifierNodes(sourceFile)) {
    const result = rewriteSpec(literal.text, fileDir, anomalies, relFile);
    if (!result) continue;
    const quote = text[literal.getStart(sourceFile)];
    edits.push({
      start: literal.getStart(sourceFile),
      end: literal.getEnd(),
      replacement: `${quote}${result.newSpec}${quote}`,
    });
    counts[aliasFor(result.root)] += 1;
  }
  if (edits.length === 0) continue;

  edits.sort((a, b) => b.start - a.start);
  let next = text;
  for (const { start, end, replacement } of edits) {
    next = next.slice(0, start) + replacement + next.slice(end);
  }
  if (!dry) writeFileSync(file, next);
  filesChanged += 1;
  totalRewrites += edits.length;
}

console.log(`${dry ? '[dry run] ' : ''}Rewrites per alias:`);
for (const [alias, count] of Object.entries(counts)) {
  console.log(`  ${alias.padEnd(12)} ${count}`);
}
console.log(`Total: ${totalRewrites} specifier(s) in ${filesChanged} file(s).`);

if (anomalies.length > 0) {
  console.warn(
    '\nWARNING: specifiers that name an aliased root but do not resolve ' +
      'to an existing module (left untouched — review by hand). Known ' +
      'instances as of the Phase 1 run: four dead vi.mock specifiers ' +
      '(LexiconManager.test.tsx x2, useLibraryStore.test.ts, ' +
      'test_drive_sync.test.ts) whose target modules do not exist; ' +
      'rewriting a dead mock to a live path would activate a mock that ' +
      'never applied (= behavior change), so they are skipped:',
  );
  for (const { context, spec, resolved } of anomalies) {
    console.warn(`  ${context}: '${spec}' -> ${resolved}`);
  }
}
