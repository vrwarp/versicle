/**
 * Pinyin font contract (Phase 8 §I) — the OFL compliance + glyph-coverage
 * invariants of the shipped derivative, asserted against the BINARIES:
 *
 *  1. naming records carry 'Versicle Sans Narrow' and never the Reserved
 *     Font Name ('PT Sans …'); the trademark record (nameID 7) is gone.
 *     ParaType ATTRIBUTION remains in copyright/license records (IDs
 *     0/8/13) — the OFL requires retaining those notices; the inventory
 *     records them as provenance text.
 *  2. the five injected pinyin tone codepoints (ǎ ǐ ǒ ǔ ǚ — the entire
 *     point of the derivative) stay mapped in the cmap. This is the
 *     machine-checkable core of the §I "pinyin visual golden": the rename
 *     script (scripts/build-pinyin-font.py) asserts glyf/cmap byte
 *     equality at build time, and this test pins the mapping forever.
 *  3. index.css references only the renamed family/files.
 *
 * Pure-Node TTF parsing (name table + cmap format 4/12) — no font
 * dependency in the JS toolchain.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fontsDir = join(repoRoot, 'public', 'fonts');

const PINYIN_CODEPOINTS = [0x01ce, 0x01d0, 0x01d2, 0x01d4, 0x01da]; // ǎ ǐ ǒ ǔ ǚ
/** Naming/description IDs that must be RFN-free (license IDs 0/8/13 exempt). */
const NAMING_IDS = new Set([1, 3, 4, 6, 10, 16, 17, 18]);

interface TableRecord {
  offset: number;
  length: number;
}

function tableDirectory(view: DataView): Map<string, TableRecord> {
  const numTables = view.getUint16(4);
  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3),
    );
    tables.set(tag, { offset: view.getUint32(base + 8), length: view.getUint32(base + 12) });
  }
  return tables;
}

/** Decode all name records: nameID → decoded strings (all platforms). */
function readNameRecords(view: DataView, table: TableRecord): Map<number, string[]> {
  const base = table.offset;
  const count = view.getUint16(base + 2);
  const stringOffset = base + view.getUint16(base + 4);
  const out = new Map<number, string[]>();
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    const platformID = view.getUint16(rec);
    const nameID = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = stringOffset + view.getUint16(rec + 10);
    let text = '';
    if (platformID === 3 || platformID === 0) {
      for (let j = 0; j < length; j += 2) text += String.fromCharCode(view.getUint16(offset + j));
    } else {
      for (let j = 0; j < length; j++) text += String.fromCharCode(view.getUint8(offset + j));
    }
    out.set(nameID, [...(out.get(nameID) ?? []), text]);
  }
  return out;
}

/** Look up a codepoint in the best cmap subtable (format 4, BMP). */
function cmapHasCodepoint(view: DataView, table: TableRecord, codepoint: number): boolean {
  const base = table.offset;
  const numSubtables = view.getUint16(base + 2);
  for (let i = 0; i < numSubtables; i++) {
    const rec = base + 4 + i * 8;
    const platformID = view.getUint16(rec);
    const encodingID = view.getUint16(rec + 2);
    if (!(platformID === 3 && encodingID === 1) && !(platformID === 0)) continue;
    const sub = base + view.getUint32(rec + 4);
    if (view.getUint16(sub) !== 4) continue;
    const segCount = view.getUint16(sub + 6) / 2;
    const endCodes = sub + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    for (let seg = 0; seg < segCount; seg++) {
      const end = view.getUint16(endCodes + seg * 2);
      if (codepoint > end) continue;
      const start = view.getUint16(startCodes + seg * 2);
      if (codepoint < start) break;
      const rangeOffset = view.getUint16(idRangeOffsets + seg * 2);
      if (rangeOffset === 0) {
        return ((codepoint + view.getInt16(idDeltas + seg * 2)) & 0xffff) !== 0;
      }
      const glyphAddr = idRangeOffsets + seg * 2 + rangeOffset + (codepoint - start) * 2;
      const glyph = view.getUint16(glyphAddr);
      if (glyph === 0) return false;
      return ((glyph + view.getInt16(idDeltas + seg * 2)) & 0xffff) !== 0;
    }
  }
  return false;
}

const FONT_FILES = ['VersicleSansNarrow-Regular.ttf', 'VersicleSansNarrow-Bold.ttf'];

describe.each(FONT_FILES)('pinyin font contract: %s', (file) => {
  const buf = readFileSync(join(fontsDir, file));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = tableDirectory(view);

  it('naming records carry the renamed family and no Reserved Font Name', () => {
    const names = readNameRecords(view, tables.get('name')!);
    expect(names.get(1)).toContain('Versicle Sans Narrow');
    expect(names.get(7), 'trademark record must be deleted').toBeUndefined();
    for (const [nameID, values] of names) {
      if (!NAMING_IDS.has(nameID)) continue;
      for (const value of values) {
        expect(value, `nameID ${nameID} must not carry the RFN`).not.toContain('PT Sans');
      }
    }
  });

  it('retains the OFL license + ParaType attribution (required notices)', () => {
    const names = readNameRecords(view, tables.get('name')!);
    expect(names.get(13)?.[0]).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(names.get(0)?.[0]).toContain('ParaType');
  });

  it('maps all five injected pinyin tone glyphs (ǎ ǐ ǒ ǔ ǚ)', () => {
    for (const cp of PINYIN_CODEPOINTS) {
      expect(
        cmapHasCodepoint(view, tables.get('cmap')!, cp),
        `U+${cp.toString(16).toUpperCase()} missing from cmap`,
      ).toBe(true);
    }
  });
});

describe('pinyin font wiring', () => {
  it('public/fonts contains only the renamed files', () => {
    expect(readdirSync(fontsDir).sort()).toEqual(FONT_FILES.slice().sort());
  });

  it('index.css references only the renamed family and files', () => {
    const css = readFileSync(join(repoRoot, 'src', 'index.css'), 'utf8');
    expect(css).toContain("font-family: 'Versicle Sans Narrow'");
    expect(css).toContain('/fonts/VersicleSansNarrow-Regular.ttf');
    expect(css).toContain('/fonts/VersicleSansNarrow-Bold.ttf');
    expect(css).not.toContain('PT Sans');
    expect(css).not.toContain('PT_Sans');
  });
});
