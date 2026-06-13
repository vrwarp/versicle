#!/usr/bin/env node
/**
 * trad→simp single-character table generator (Phase 6 §7.5/§7.6,
 * plan/overhaul/prep/phase6-reader-engine.md PR-12/PR-13).
 *
 * Emits the COMMITTED table behind `canonicalizeChar`
 * (src/domains/chinese/vocabulary/trad2simp.json + .meta.json sidecar).
 *
 * RECONCILIATION vs the prep doc (§7.6 wanted the table emitted from the
 * CC-CEDICT run): the table is derived from opencc-js's bundled
 * dictionaries instead, deliberately —
 *  1. the DISPLAY path converts cn→tw through opencc-js
 *     (TraditionalConverter), so vocabulary suppression only round-trips if
 *     canonicalization inverts the SAME mapping; CC-CEDICT's trad/simp
 *     columns disagree with OpenCC on enough characters to break it;
 *  2. the table feeds the CRDT v7 migration, whose transform must be
 *     deterministic on every client — a committed, code-versioned artifact,
 *     not a network-built one (cedict.json is built per-release in CI).
 *
 * Construction (deterministic; ascending code points):
 *  pass 1: for every Han char S, T = cn2tw(S); if T ≠ S and T is a single
 *          char → table[T] = S (the exact inverse of the display mapping —
 *          first writer wins on collisions).
 *  pass 2: for every Han char T not yet mapped, S = tw2cn(T); if S ≠ T and
 *          single char → table[T] = S (traditional-source books whose
 *          glyphs are not in cn2tw's image).
 *
 * The committed output is reviewed like source. Regenerate (only) when
 * opencc-js is upgraded: npm run generate-trad2simp.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'src/domains/chinese/vocabulary');
// opencc-js's exports map hides package.json from require(); read directly.
const openccVersion = JSON.parse(
  readFileSync(join(repoRoot, 'node_modules/opencc-js/package.json'), 'utf8'),
).version;

const cn2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });
const tw2cn = OpenCC.Converter({ from: 'tw', to: 'cn' });

/** BMP Han ranges opencc-js's dictionaries cover. */
const RANGES = [
  [0x3400, 0x4dbf], // CJK Ext-A
  [0x4e00, 0x9fff], // CJK Unified
  [0xf900, 0xfad9], // CJK Compatibility Ideographs
];

const table = {};
let inverseCount = 0;
let directCount = 0;

for (const [start, end] of RANGES) {
  for (let cp = start; cp <= end; cp++) {
    const simp = String.fromCodePoint(cp);
    const trad = cn2tw(simp);
    if (trad !== simp && Array.from(trad).length === 1 && !(trad in table)) {
      table[trad] = simp;
      inverseCount++;
    }
  }
}
// Characters pass 1 established as CANONICAL (simplified) forms must never
// become keys: mutual variant preferences (cn prefers 镢, tw prefers 䦆 —
// cn2tw(镢)=䦆 AND tw2cn(镢)=䦆) would otherwise create 2-cycles that flip
// the table's direction for one of the pair.
const canonical = new Set(Object.values(table));
for (const [start, end] of RANGES) {
  for (let cp = start; cp <= end; cp++) {
    const trad = String.fromCodePoint(cp);
    if (trad in table || canonical.has(trad)) continue;
    const simp = tw2cn(trad);
    if (simp !== trad && Array.from(simp).length === 1) {
      table[trad] = simp;
      directCount++;
    }
  }
}

// Normalization passes, iterated to a FIXPOINT (each can enable the next):
//
//  CHAIN RESOLUTION (idempotence invariant): pass 2 can emit values that
//  are themselves keys (variant K → 喫 while 喫 → 吃) — resolve every
//  value transitively; drop self-mappings; a cycle keeps the original.
//
//  DISPLAY CLOSURE (round-trip invariant): for every canonical value, the
//  reader's cn→tw display form must canonicalize back. Values can live
//  outside the iterated BMP ranges (tw2cn emits astral simplified forms),
//  so display forms are added regardless of plane.
//
//  CLASS UNIFICATION (one representative per display class): cn2tw is
//  many-to-one (cn2tw(镢) = cn2tw(䦆) = 钁) — two distinct "canonical"
//  values sharing a display form would make suppression depend on which
//  one the user stored. The display key's existing value becomes the class
//  representative; the other value becomes a key onto it.
let resolved = 0;
let closure = 0;
let unified = 0;
for (let iteration = 0; iteration < 8; iteration++) {
  let changed = false;

  for (const key of Object.keys(table)) {
    let value = table[key];
    const seen = new Set([key]);
    while (value in table && !seen.has(value)) {
      seen.add(value);
      value = table[value];
    }
    if (value !== table[key]) {
      table[key] = value;
      resolved++;
      changed = true;
    }
    if (key === table[key]) {
      delete table[key];
      changed = true;
    }
  }

  for (const value of new Set(Object.values(table))) {
    const displayed = cn2tw(value);
    if (displayed === value || Array.from(displayed).length !== 1) continue;
    if (!(displayed in table)) {
      table[displayed] = value;
      closure++;
      changed = true;
    } else if (table[displayed] !== value && !(value in table)) {
      // Same display form, different representative: unify the class.
      table[value] = table[displayed];
      unified++;
      changed = true;
    }
  }

  if (!changed) break;
}

// Self-check the two invariants the committed artifact guarantees
// (src/domains/chinese/vocabulary/canonicalize.test.ts re-asserts them).
for (const [key, value] of Object.entries(table)) {
  if (value in table) throw new Error(`non-canonical value: ${key} → ${value}`);
  if (Array.from(key).length !== 1 || Array.from(value).length !== 1) {
    throw new Error(`multi-code-point entry: ${key} → ${value}`);
  }
}
for (const value of new Set(Object.values(table))) {
  const displayed = cn2tw(value);
  if (Array.from(displayed).length === 1 && displayed !== value && table[displayed] !== value) {
    throw new Error(`display round-trip broken: ${value} displays as ${displayed} → ${table[displayed]}`);
  }
}

const sorted = Object.fromEntries(
  Object.entries(table).sort(([a], [b]) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)),
);

writeFileSync(join(outDir, 'trad2simp.json'), JSON.stringify(sorted) + '\n');
writeFileSync(
  join(outDir, 'trad2simp.meta.json'),
  JSON.stringify(
    {
      generator: 'scripts/generate-trad2simp.mjs',
      source: `opencc-js@${openccVersion} bundled dictionaries (cn↔tw)`,
      license: 'Apache-2.0 (OpenCC dictionary data)',
      entryCount: Object.keys(sorted).length,
      fromInverseOfDisplayMapping: inverseCount,
      fromDirectTw2Cn: directCount,
      chainResolved: resolved,
      displayClosureAdded: closure,
      displayClassUnified: unified,
      rationale:
        'Must invert the EXACT cn→tw mapping the reader displays with ' +
        '(TraditionalConverter), and must be a committed code-versioned ' +
        'artifact because it feeds the deterministic CRDT v7 migration.',
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `trad2simp.json: ${Object.keys(sorted).length} entries ` +
    `(${inverseCount} inverse-of-display, ${directCount} direct tw2cn, ` +
    `${resolved} chain-resolved, ${closure} display-closure, ${unified} class-unified) — opencc-js@${openccVersion}`,
);
