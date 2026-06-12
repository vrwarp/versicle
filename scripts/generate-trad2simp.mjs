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
for (const [start, end] of RANGES) {
  for (let cp = start; cp <= end; cp++) {
    const trad = String.fromCodePoint(cp);
    if (trad in table) continue;
    const simp = tw2cn(trad);
    if (simp !== trad && Array.from(simp).length === 1) {
      table[trad] = simp;
      directCount++;
    }
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
    `(${inverseCount} inverse-of-display, ${directCount} direct tw2cn) — opencc-js@${openccVersion}`,
);
