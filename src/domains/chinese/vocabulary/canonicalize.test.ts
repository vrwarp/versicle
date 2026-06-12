/**
 * canonicalize suite (Phase 6 §7.5, PR-13): the CH-6 single-char table
 * invariants — including the §7.3 length-preservation check over the FULL
 * committed table and the display round-trip invariant the suppression
 * read path depends on.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  canonicalizeChar,
  getTrad2SimpTable,
  mergeCanonicalTimestamps,
} from './canonicalize';
import { ensureOpenCC, toTraditional } from '../engine/TraditionalConverter';

describe('canonicalizeChar', () => {
  it('maps traditional single chars to simplified; identity otherwise', () => {
    expect(canonicalizeChar('紅')).toBe('红');
    expect(canonicalizeChar('樓')).toBe('楼');
    expect(canonicalizeChar('夢')).toBe('梦');
    expect(canonicalizeChar('红')).toBe('红'); // already simplified
    expect(canonicalizeChar('中')).toBe('中'); // shared glyph
    expect(canonicalizeChar('a')).toBe('a'); // non-Han
    expect(canonicalizeChar('\u{20000}')).toBe('\u{20000}'); // astral, no mapping
  });

  it('is idempotent over the whole table (canonical forms map to themselves)', () => {
    for (const simplified of Object.values(getTrad2SimpTable())) {
      expect(canonicalizeChar(simplified)).toBe(simplified);
    }
  });
});

describe('trad2simp table invariants (committed artifact)', () => {
  const table = getTrad2SimpTable();

  it('every key and value is exactly ONE code point (the §7.3 length-preservation guarantee)', () => {
    for (const [trad, simp] of Object.entries(table)) {
      expect(Array.from(trad).length, `key ${trad}`).toBe(1);
      expect(Array.from(simp).length, `value for ${trad}`).toBe(1);
      expect(trad).not.toBe(simp);
    }
  });

  it('inverts the DISPLAY mapping: cn→tw of every canonical value round-trips through canonicalizeChar', async () => {
    // The suppression invariant: a character stored simplified must be
    // recognized when the reader displays its OpenCC traditional form.
    await ensureOpenCC();
    let displayPairs = 0;
    for (const simplified of new Set(Object.values(table))) {
      const displayed = toTraditional(simplified);
      if (Array.from(displayed).length !== 1) continue; // multi-char display forms are out of single-char scope
      expect(canonicalizeChar(displayed), `display form of ${simplified}`).toBe(simplified);
      if (displayed !== simplified) displayPairs += 1;
    }
    expect(displayPairs).toBeGreaterThan(2000); // the table is not vestigial
  });
});

describe('mergeCanonicalTimestamps (the v7 LWW-safe merge rule)', () => {
  it('min of two numerics; lone numeric wins; both malformed → undefined', () => {
    expect(mergeCanonicalTimestamps(100, 200)).toBe(100);
    expect(mergeCanonicalTimestamps(200, 100)).toBe(100);
    expect(mergeCanonicalTimestamps(undefined, 100)).toBe(100);
    expect(mergeCanonicalTimestamps(100, undefined)).toBe(100);
    expect(mergeCanonicalTimestamps('corrupt', 100)).toBe(100);
    expect(mergeCanonicalTimestamps(NaN, 100)).toBe(100);
    expect(mergeCanonicalTimestamps(undefined, 'corrupt')).toBeUndefined();
  });
});

describe('regression: vocabulary write path canonicalizes (CH-6 layer 1)', () => {
  let useVocabularyStore: typeof import('@store/useVocabularyStore').useVocabularyStore;

  beforeAll(async () => {
    ({ useVocabularyStore } = await import('@store/useVocabularyStore'));
  });

  it('toggle/mark with a TRADITIONAL char reads and writes the simplified key', () => {
    useVocabularyStore.setState({ knownCharacters: {} });
    const store = useVocabularyStore.getState();

    store.toggleKnownCharacter('紅'); // traditional input
    expect(Object.keys(useVocabularyStore.getState().knownCharacters)).toEqual(['红']);

    // Toggling under EITHER script removes the same canonical key.
    useVocabularyStore.getState().toggleKnownCharacter('红');
    expect(useVocabularyStore.getState().knownCharacters).toEqual({});

    useVocabularyStore.getState().markAsKnown('樓');
    expect(Object.keys(useVocabularyStore.getState().knownCharacters)).toEqual(['楼']);
    useVocabularyStore.getState().markAsUnknown('樓');
    expect(useVocabularyStore.getState().knownCharacters).toEqual({});
  });
});
