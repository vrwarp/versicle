import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import {
  FIXTURE_ERAS,
  DEVICE_A,
  BOOK_EN,
  BOOK_CJK,
} from '@test/fixtures/ydoc/seed';

/**
 * Captured-fixture drift guard (phase2-fork-surgery.md §4.2): the committed
 * v{1,2,4,5,6,7}.update.bin files are REVIEWED artifacts — this test pins
 * manifest↔file sha256 agreement and the structural content checklist so the
 * bytes cannot drift silently (and a fixture regeneration that forgets the
 * manifest, or vice versa, fails CI).
 */

// vitest's jsdom environment rewrites import.meta.url to a non-file URL;
// resolve from the repo root instead (vitest always runs from it).
const fixtureDir = join(process.cwd(), 'src', 'test', 'fixtures', 'ydoc');

interface ManifestEntry {
  era: number;
  file: string;
  sha256: string;
  method: string;
  fidelityNote: string;
  generator: string;
  generatorSha: string;
  capturedAt: string;
  contentChecklist: string[];
}

const manifest: { fixtures: Record<string, ManifestEntry> } = JSON.parse(
  readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'),
);

const loadDoc = (file: string): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(readFileSync(join(fixtureDir, file))));
  return doc;
};

describe('ydoc fixture manifest guard', () => {
  it('covers exactly the expected eras, and every committed .bin has a manifest entry', () => {
    expect(Object.keys(manifest.fixtures).sort()).toEqual(
      FIXTURE_ERAS.map((e) => `v${e}`).sort(),
    );
    const binFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.update.bin'));
    expect(binFiles.sort()).toEqual(
      Object.values(manifest.fixtures).map((f) => f.file).sort(),
    );
  });

  it.each(Object.entries(manifest.fixtures))(
    '%s: file bytes match the manifest sha256 and provenance fields are complete',
    (_name, entry) => {
      const bytes = readFileSync(join(fixtureDir, entry.file));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(sha256).toBe(entry.sha256);
      for (const field of [
        'method',
        'fidelityNote',
        'generator',
        'generatorSha',
        'capturedAt',
      ] as const) {
        expect(entry[field], `manifest field ${field}`).toBeTruthy();
      }
      expect(entry.contentChecklist.length).toBeGreaterThan(0);
    },
  );

  it.each(FIXTURE_ERAS)('v%i: doc structure matches the content checklist', (era) => {
    const doc = loadDoc(`v${era}.update.bin`);

    const library = doc.getMap('library');
    expect(library.get('__schemaVersion')).toBe(era);
    const books = (library.get('books') as Y.Map<unknown>).toJSON() as Record<
      string,
      { title: string }
    >;
    expect(Object.keys(books).sort()).toEqual([BOOK_EN, BOOK_CJK].sort());
    expect(books[BOOK_CJK].title).toBe('紅樓夢'); // CJK round-trips all eras

    // Era string encoding: pre-v4 → Y.Text, v4+ → plain strings.
    const bookEn = (library.get('books') as Y.Map<unknown>).get(BOOK_EN) as Y.Map<unknown>;
    if (era >= 4) {
      expect(typeof bookEn.get('title')).toBe('string');
    } else {
      expect(bookEn.get('title')).toBeInstanceOf(Y.Text);
    }

    // v1 carries the corrupt session the v1→v2 migration prunes.
    const progress = (doc.getMap('progress').get('progress') as Y.Map<unknown>).toJSON() as Record<
      string,
      Record<string, { readingSessions: { startTime: unknown }[] }>
    >;
    const sessions = progress[BOOK_EN][DEVICE_A].readingSessions;
    if (era === 1) {
      expect(sessions.some((s) => s.startTime === 'corrupt')).toBe(true);
    } else {
      expect(sessions.every((s) => typeof s.startTime === 'number')).toBe(true);
    }

    // Stale popover key: v4/v5 only (pre-hotfix annotations shape; the v6
    // migration deletes it, so the era-6 terminal-shape fixture lacks it).
    expect(doc.getMap('annotations').has('popover')).toBe(era === 4 || era === 5);

    // fontProfiles exists from v5 on (the v4→v5 backfill).
    expect(doc.getMap(`preferences/${DEVICE_A}`).has('fontProfiles')).toBe(era >= 5);

    // v6/v7: terminal era shapes — folded preferences + staged meta surface.
    // v6 carries TRADITIONAL vocabulary keys incl. the 紅/红 duplicate pair
    // (the v7 canonicalization input, Phase 6 PR-13); v7 carries the
    // CANONICAL simplified keys (the v7 output, duplicate pair min-merged).
    if (era >= 6) {
      expect(doc.getMap('meta').get('schemaVersion')).toBe(era);
      expect((doc.getMap('preferences').get(DEVICE_A) as Y.Map<unknown>).has('fontProfiles')).toBe(true);
      const vocab = (doc.getMap('vocabulary').get('knownCharacters') as Y.Map<unknown>).toJSON();
      expect(Object.keys(vocab).sort()).toEqual(
        era >= 7 ? ['红', '楼', '梦'].sort() : ['樓', '紅', '红', '夢'].sort(),
      );
    }

    // Reading list: three entries — exact-filename match, fuzzy match,
    // orphan. The bookId FK is born at the v8 linker step: eras ≤ 7 carry
    // NONE; the era-8 terminal-v8 shape carries the linker OUTPUT (both
    // matches linked, orphan unlinked).
    const entries = (doc.getMap('reading-list').get('entries') as Y.Map<unknown>).toJSON() as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(entries).sort()).toEqual(
      ['alice.epub', 'frankenstein.epub', 'hong-lou-meng (1).epub'].sort(),
    );
    if (era >= 8) {
      expect(entries['alice.epub'].bookId).toBe(BOOK_EN);
      expect(entries['hong-lou-meng (1).epub'].bookId).toBe(BOOK_CJK);
      expect('bookId' in entries['frankenstein.epub']).toBe(false);
    } else {
      expect(Object.values(entries).some((entry) => 'bookId' in entry)).toBe(false);
    }

    // Era 8 (the v9 husk-clear INPUT): the legacy husks are still populated
    // and every preferences map still carries the de-synced activeContext.
    if (era >= 6) {
      expect((doc.getMap(`preferences/${DEVICE_A}`).toJSON() as Record<string, unknown>)['activeContext']).toBe('library');
      expect(((doc.getMap('preferences').get(DEVICE_A) as Y.Map<unknown>).toJSON())['activeContext']).toBe('library');
    }
  });
});
