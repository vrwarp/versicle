#!/usr/bin/env node
/**
 * types/db.ts shim-retirement codemod (Phase 9, plan/overhaul/README.md
 * §Roadmap P9; master plan §4 rule 2 — the shim's named deletion deadline).
 *
 * `src/types/db.ts` is the Phase 1a re-export shim over the six domain type
 * modules the 934-line god hub was dissolved into. This script rewrites
 * every remaining importer to the OWNING module so the shim can be deleted:
 *
 *   import type { BookMetadata, Annotation } from '~types/db';
 *     -> import type { BookMetadata } from '~types/book';
 *        import type { Annotation } from '~types/user-data';
 *
 * Mechanics (follows scripts/codemod-aliases.mjs: TS AST, bottom-up string
 * edits, never regex-on-source):
 *  - The name -> module map is built by PARSING the six domain modules'
 *    exported declarations and named re-exports (the shim is
 *    `export type *`, so its surface is exactly the union of those).
 *    Cross-module name collisions are detected and FAIL the run: under
 *    `export *` an ambiguous name is silently dropped by TypeScript, so a
 *    collision would mean the shim never legally served that name anyway.
 *  - Rewritten positions: static `import`/`import type` declarations with
 *    named bindings (both `import type {X}` and `import {type X}` forms
 *    normalize to top-level `import type` — the repo's
 *    consistent-type-imports posture), and inline `import('~types/db').X`
 *    type annotations. Namespace imports of the shim do not exist (verified
 *    by grep; the script reports and skips any it encounters).
 *  - Both the `~types/db` alias and relative specifiers resolving to
 *    src/types/db are handled.
 *  - Names the map cannot place are reported and the file is left
 *    untouched (loud failure over silent misdirection).
 *
 * Usage:
 *   node scripts/codemod-types-db.mjs          rewrite in place + summary
 *   node scripts/codemod-types-db.mjs --dry    report only, write nothing
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'src');
const dry = process.argv.includes('--dry');

/** The six domain modules, in the shim's re-export order (db.ts). */
const DOMAIN_MODULES = ['book', 'user-data', 'tts', 'cache', 'flight-recorder', 'sync'];

// ─── 1. Build the exported-name → module map ────────────────────────────────

/** @returns {Set<string>} every exported (type) name of one module. */
function exportedNames(moduleFile) {
  const text = readFileSync(moduleFile, 'utf8');
  const sf = ts.createSourceFile(moduleFile, text, ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const stmt of sf.statements) {
    const hasExport = ts.canHaveModifiers(stmt) &&
      ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (
      hasExport &&
      (ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isClassDeclaration(stmt)) &&
      stmt.name
    ) {
      names.add(stmt.name.text);
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) names.add(el.name.text);
    } else if (ts.isExportDeclaration(stmt) && !stmt.exportClause) {
      console.error(`UNSUPPORTED: star re-export in ${moduleFile} — extend the codemod first.`);
      process.exit(1);
    } else if (hasExport && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
    }
  }
  return names;
}

/** name -> module short name (e.g. 'BookMetadata' -> 'book'). */
const owner = new Map();
const collisions = new Set();
for (const mod of DOMAIN_MODULES) {
  for (const name of exportedNames(path.join(srcRoot, 'types', `${mod}.ts`))) {
    if (owner.has(name) && owner.get(name) !== mod) collisions.add(name);
    else if (!owner.has(name)) owner.set(name, mod);
  }
}

// ─── 2. Collect importer files ──────────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) yield full;
  }
}

const shimPath = path.join(srcRoot, 'types', 'db');
/** Does this module specifier (from this importer) target the shim? */
function targetsShim(specifier, importerFile) {
  if (specifier === '~types/db') return true;
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(importerFile), specifier);
  return resolved === shimPath;
}

// ─── 3. Rewrite ─────────────────────────────────────────────────────────────

let filesChanged = 0;
let importsRewritten = 0;
let inlineRewritten = 0;
const problems = [];

for (const file of [...walk(srcRoot), ...walk(path.join(repoRoot, 'verification'))]) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('types/db')) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  /** @type {{start: number, end: number, replacement: string}[]} */
  const edits = [];
  let fileProblem = false;

  const visit = (node) => {
    // Inline `import('~types/db').X` type annotations.
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      targetsShim(node.argument.literal.text, file)
    ) {
      const qualifier = node.qualifier;
      const leftmost = qualifier && (ts.isIdentifier(qualifier) ? qualifier : qualifier.left);
      const name = leftmost && ts.isIdentifier(leftmost) ? leftmost.text : undefined;
      const mod = name !== undefined ? owner.get(name) : undefined;
      if (name === undefined || mod === undefined || collisions.has(name)) {
        problems.push(`${file}: cannot place inline import('~types/db').${name ?? '?'}`);
        fileProblem = true;
      } else {
        const lit = node.argument.literal;
        edits.push({ start: lit.getStart(sf) + 1, end: lit.getEnd() - 1, replacement: `~types/${mod}` });
        inlineRewritten += 1;
      }
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (targetsShim(spec, file)) {
        const clause = node.importClause;
        if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
          problems.push(`${file}: unsupported import form for '${spec}' (no named bindings)`);
          fileProblem = true;
        } else {
          /** module -> list of import-specifier source texts (alias-preserving). */
          const byModule = new Map();
          let ok = true;
          for (const el of clause.namedBindings.elements) {
            // The EXPORTED name is propertyName (alias form) or name.
            const exported = (el.propertyName ?? el.name).text;
            const mod = owner.get(exported);
            if (mod === undefined || collisions.has(exported)) {
              problems.push(`${file}: cannot place '${exported}' from '${spec}'`);
              ok = false;
              break;
            }
            const rendered = (el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text);
            if (!byModule.has(mod)) byModule.set(mod, []);
            byModule.get(mod).push(rendered);
          }
          if (ok) {
            // Emit in domain-module order for determinism; top-level
            // `import type` (the shim only ever exported types).
            const lines = DOMAIN_MODULES.filter((mod) => byModule.has(mod)).map(
              (mod) => `import type { ${byModule.get(mod).join(', ')} } from '~types/${mod}';`,
            );
            edits.push({ start: node.getStart(sf), end: node.getEnd(), replacement: lines.join('\n') });
            importsRewritten += 1;
          } else {
            fileProblem = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (fileProblem || edits.length === 0) continue;

  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  if (!dry) writeFileSync(file, out);
  filesChanged += 1;
}

if (collisions.size > 0) {
  console.log(`NOTE: ${collisions.size} ambiguous name(s) across domain modules (never legally importable via the shim): ${[...collisions].join(', ')}`);
}
console.log(`${dry ? '[dry] ' : ''}${filesChanged} file(s) rewritten — ${importsRewritten} import declaration(s), ${inlineRewritten} inline import type(s).`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) — these files were left untouched:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
