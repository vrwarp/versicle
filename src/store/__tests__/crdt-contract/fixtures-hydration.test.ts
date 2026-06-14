import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjsMiddleware from 'zustand-middleware-yjs';
import { DEVICE_A, BOOK_EN, BOOK_CJK } from '@test/fixtures/ydoc/seed';

/**
 * Fixture hydration matrix — CURRENT (legacy) semantics pinned against the
 * captured era docs (phase2-fork-surgery.md §4 consumers; precursor of suite
 * F.1, which re-runs this matrix through the surgically-modified middleware
 * as each store flips to merge-defaults).
 *
 * Stores here are minimal mirrors of the app stores' synced state (current
 * defaults), bound to fresh docs loaded from the committed fixtures — the
 * real app stores are bound to the provider's singleton yDoc and can't be
 * rebound per fixture. Options mirror getYjsOptions(): disableYText: true.
 *
 * The pins deliberately include the bugs Phase 2 fixes:
 *   - D2 fontProfiles wipe: hydrating a v4 doc DELETES the fontProfiles
 *     default (why the v4→v5 migration exists);
 *   - phantom popover: the stale doc key is inserted INTO store state
 *     (what syncedKeys B.2 will stop).
 */

// vitest's jsdom environment rewrites import.meta.url to a non-file URL;
// resolve from the repo root instead (vitest always runs from it).
const fixtureDir = join(process.cwd(), 'src', 'test', 'fixtures', 'ydoc');

const loadDoc = (era: 1 | 2 | 4 | 5): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(readFileSync(join(fixtureDir, `v${era}.update.bin`))));
  return doc;
};

const drain = () => new Promise<void>((r) => setTimeout(r, 0));

/** Current preferences-store synced shape (defaults incl. fontProfiles, post-v5). */
interface PrefsState {
  currentTheme: string;
  fontFamily: string;
  fontProfiles: Record<string, { fontSize: number; lineHeight: number }>;
  setFontFamily: (f: string) => void;
}
const prefsCreator = (set: (p: Partial<PrefsState>) => void): PrefsState => ({
  currentTheme: 'light',
  fontFamily: 'serif',
  fontProfiles: {
    en: { fontSize: 100, lineHeight: 1.5 },
    zh: { fontSize: 120, lineHeight: 1.8 },
  },
  setFontFamily: (fontFamily) => set({ fontFamily }),
});

describe('fixture hydration — legacy replace semantics (current behavior)', () => {
  it('v5: preferences hydrate fully, fontProfiles comes from the doc', () => {
    const doc = loadDoc(5);
    const store = createStore<PrefsState>()(
      yjsMiddleware(doc, `preferences/${DEVICE_A}`, prefsCreator, { disableYText: true }),
    );

    expect(store.getState().currentTheme).toBe('sepia');
    expect(store.getState().fontFamily).toBe('Literata');
    expect(store.getState().fontProfiles).toEqual({
      en: { fontSize: 100, lineHeight: 1.5 },
      zh: { fontSize: 120, lineHeight: 1.8 },
    });
  });

  it('v4: PINNED D2 BUG — the fontProfiles default is WIPED by hydration (the wipe class merge-defaults will fix)', () => {
    const doc = loadDoc(4);
    const store = createStore<PrefsState>()(
      yjsMiddleware(doc, `preferences/${DEVICE_A}`, prefsCreator, { disableYText: true }),
    );

    expect(store.getState().currentTheme).toBe('sepia'); // doc data hydrates…
    // …but the default for the doc-absent key is deleted, not retained.
    // This exact wipe is why the v4→v5 migration backfills fontProfiles.
    expect('fontProfiles' in store.getState()).toBe(false);
  });

  it('v5: PINNED phantom-key class — the stale popover doc key is inserted into store state', async () => {
    interface AnnState {
      annotations: Record<string, { text: string }>;
    }
    const doc = loadDoc(5);
    const store = createStore<AnnState>()(
      yjsMiddleware(doc, 'annotations', () => ({ annotations: {} }), {
        disableYText: true,
      }),
    );
    await drain();

    expect(Object.keys(store.getState().annotations).sort()).toEqual([
      'fixture-annotation-1',
      'fixture-annotation-2',
    ]);
    // Current middleware has no replication whitelist: the pre-hotfix junk
    // key rides into state. syncedKeys (contract case B.2) flips this pin.
    const state = store.getState() as unknown as Record<string, unknown>;
    expect(state['popover']).toMatchObject({ visible: false, x: 312, y: 480 });
  });

  it('v1: Y.Text-era books hydrate as plain strings in state; CJK intact; corrupt session visible pre-migration', () => {
    interface LibraryState {
      __schemaVersion: number;
      books: Record<string, { title: string; author: string }>;
    }
    const doc = loadDoc(1);
    const library = createStore<LibraryState>()(
      yjsMiddleware(doc, 'library', () => ({ __schemaVersion: 5, books: {} }), {
        disableYText: true,
      }),
    );

    // Hydration reads through toJSON(): Y.Text values arrive as strings…
    expect(library.getState().books[BOOK_EN].title).toBe(
      "Alice's Adventures in Wonderland",
    );
    expect(library.getState().books[BOOK_CJK].title).toBe('紅樓夢');
    // …and the doc's version wins over the store's declared one (hydration
    // is a full replace — this is what the migration runner reads).
    expect(library.getState().__schemaVersion).toBe(1);
    // The stored value is still Y.Text (repair is lazy, contract A.9).
    const bookEn = (doc.getMap('library').get('books') as Y.Map<unknown>).get(
      BOOK_EN,
    ) as Y.Map<unknown>;
    expect(bookEn.get('title')).toBeInstanceOf(Y.Text);

    interface ProgressState {
      progress: Record<
        string,
        Record<string, { readingSessions?: { startTime: unknown }[] }>
      >;
    }
    const progress = createStore<ProgressState>()(
      yjsMiddleware(doc, 'progress', () => ({ progress: {} }), {
        disableYText: true,
      }),
    );
    const sessions =
      progress.getState().progress[BOOK_EN][DEVICE_A].readingSessions ?? [];
    expect(sessions.some((s) => s.startTime === 'corrupt')).toBe(true);
  });

  it('v2: sessions are pruned; Y.Text repair path converts a written string to plain (A.9 against a real era doc)', async () => {
    interface PrefsMini {
      fontFamily: string;
      setFontFamily: (f: string) => void;
    }
    const doc = loadDoc(2);

    const prefs = createStore<PrefsMini>()(
      yjsMiddleware(
        doc,
        `preferences/${DEVICE_A}`,
        (set) => ({
          fontFamily: 'serif',
          setFontFamily: (fontFamily) => set({ fontFamily }),
        }),
        { disableYText: true },
      ),
    );
    expect(prefs.getState().fontFamily).toBe('Literata');
    expect(doc.getMap(`preferences/${DEVICE_A}`).get('fontFamily')).toBeInstanceOf(Y.Text);

    // Writing the key under the v4+ config repairs it to a plain string.
    prefs.getState().setFontFamily('Atkinson Hyperlegible');
    await drain();
    expect(doc.getMap(`preferences/${DEVICE_A}`).get('fontFamily')).toBe(
      'Atkinson Hyperlegible',
    );

    interface ProgressState {
      progress: Record<
        string,
        Record<string, { readingSessions?: { startTime: unknown }[] }>
      >;
    }
    const progress = createStore<ProgressState>()(
      yjsMiddleware(doc, 'progress', () => ({ progress: {} }), {
        disableYText: true,
      }),
    );
    const sessions =
      progress.getState().progress[BOOK_EN][DEVICE_A].readingSessions ?? [];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => typeof s.startTime === 'number')).toBe(true);
  });
});
