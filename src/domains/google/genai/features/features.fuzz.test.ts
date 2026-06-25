/**
 * GenAI feature-module fuzz suite (Phase 7 §H, PR-A3 entry gate — runs
 * BEFORE any consumer migrates): seeded malformed/out-of-contract responses
 * per feature; clamp + membership assertions; "validation failure ⇒ typed
 * error, nothing silently accepted" (GG-5).
 *
 * Includes the named regression for the verified GG-5 critical: a model
 * returning referenceStartIndex -2 used to classify EVERY group as
 * 'reference' and poison the synced contentAnalysis map.
 */
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '@test/fuzz-utils';
import { GenAIInvalidResponseError } from '../errors';
import { MockGenAIClient } from '../MockGenAIClient';
import { validateTocTitles, generateTocTitles } from './tocTitles';
import { validateReferenceDetection, detectReferenceSection } from './referenceDetection';
import { validateTableAdaptations } from './tableAdaptation';
import { validateLibraryMappings, mapReadingListToLibrary } from './libraryMapping';

describe('referenceDetection validation', () => {
  const base = { justification: 'because', agreedWithHeuristic: true };

  it('accepts the full legal range [-1, n-1]', () => {
    for (let i = -1; i < 5; i++) {
      expect(
        validateReferenceDetection({ ...base, referenceStartIndex: i }, 5).referenceStartIndex,
      ).toBe(i);
    }
  });

  it('regression (GG-5): -2 and other out-of-range indices throw instead of flagging every group', async () => {
    for (const bad of [-2, -100, 5, 99]) {
      expect(() => validateReferenceDetection({ ...base, referenceStartIndex: bad }, 5)).toThrow(
        GenAIInvalidResponseError,
      );
    }
    // End-to-end through the feature + mock client: the poisoned response
    // REJECTS — callers mark status:'error', nothing persists.
    const client = new MockGenAIClient({
      response: { ...base, referenceStartIndex: -2 },
      delayMs: 0,
    });
    await expect(
      detectReferenceSection(
        client,
        [
          { id: '0', sampleText: 'a' },
          { id: '1', sampleText: 'b' },
        ],
        { enumeratorCandidate: -1 },
      ),
    ).rejects.toBeInstanceOf(GenAIInvalidResponseError);
  });

  it('positional guard: early-chapter indices throw for sections with > 5 groups', () => {
    // Index 4 in a 29-group section (13.8%) — the exact bug case from the evaluation
    expect(() => validateReferenceDetection({ ...base, referenceStartIndex: 4 }, 29)).toThrow(
      GenAIInvalidResponseError,
    );
    // Index 1 in a 29-group section (3.4%)
    expect(() => validateReferenceDetection({ ...base, referenceStartIndex: 1 }, 29)).toThrow(
      GenAIInvalidResponseError,
    );
    // Index 2 in a 10-group section (20%)
    expect(() => validateReferenceDetection({ ...base, referenceStartIndex: 2 }, 10)).toThrow(
      GenAIInvalidResponseError,
    );
  });

  it('positional guard: indices at or past 40% are accepted', () => {
    // Index 12 in a 29-group section (41.4%) — just past the threshold
    expect(
      validateReferenceDetection({ ...base, referenceStartIndex: 12 }, 29).referenceStartIndex,
    ).toBe(12);
    // Index 4 in a 10-group section (40%) — exactly at threshold
    expect(
      validateReferenceDetection({ ...base, referenceStartIndex: 4 }, 10).referenceStartIndex,
    ).toBe(4);
    // -1 (no references) always accepted
    expect(
      validateReferenceDetection({ ...base, referenceStartIndex: -1 }, 29).referenceStartIndex,
    ).toBe(-1);
  });

  it('positional guard: bypassed for short sections (nodeCount <= 5)', () => {
    // Index 0 in a 3-group section — the whole section may be references
    expect(
      validateReferenceDetection({ ...base, referenceStartIndex: 0 }, 3).referenceStartIndex,
    ).toBe(0);
    // Index 1 in a 5-group section
    expect(
      validateReferenceDetection({ ...base, referenceStartIndex: 1 }, 5).referenceStartIndex,
    ).toBe(1);
  });

  it('maps a valid index to reference/main classifications (pinned semantics)', async () => {
    const client = new MockGenAIClient({
      response: { ...base, referenceStartIndex: 1 },
      delayMs: 0,
    });
    const result = await detectReferenceSection(
      client,
      [
        { id: '0', sampleText: 'main text' },
        { id: '1', sampleText: '[1] citation' },
        { id: '2', sampleText: '[2] citation' },
      ],
      { enumeratorCandidate: 1 },
    );
    expect(result.classifications.map((c) => c.type)).toEqual(['main', 'reference', 'reference']);
  });

  it('fuzz: arbitrary malformed shapes never pass validation silently', () => {
    const rng = new SeededRandom(20260612);
    for (let i = 0; i < 200; i++) {
      const candidates: unknown[] = [
        null,
        rng.nextString(8),
        rng.nextInt(-5, 5),
        [],
        { justification: rng.nextInt(0, 9) },
        { referenceStartIndex: rng.nextString(3) },
        { ...base, referenceStartIndex: rng.nextBool() ? 'NaN' : undefined },
      ];
      const raw = candidates[rng.nextInt(0, candidates.length - 1)];
      expect(() => validateReferenceDetection(raw, 4)).toThrow(GenAIInvalidResponseError);
    }
  });
});

describe('tocTitles validation', () => {
  const inputIds = new Set(['np-4', 'np-5']);

  it('drops entries echoing ids outside the input set (membership clamp)', () => {
    const result = validateTocTitles(
      [
        { id: 'np-4', title: 'Real' },
        { id: 'hallucinated', title: 'Fake' },
      ],
      inputIds,
    );
    expect(result).toEqual([{ id: 'np-4', title: 'Real' }]);
  });

  it('throws on shape breaches', () => {
    for (const bad of [null, 'x', [{ id: 4, title: 'n' }], [{ title: 'no id' }], { id: 'a' }]) {
      expect(() => validateTocTitles(bad, inputIds)).toThrow(GenAIInvalidResponseError);
    }
  });

  it('returns [] for empty section input without calling the model', async () => {
    const client = new MockGenAIClient({ error: 'should never be called', delayMs: 0 });
    await expect(generateTocTitles(client, [])).resolves.toEqual([]);
  });

  it('fuzz: surviving entries always reference input ids', () => {
    const rng = new SeededRandom(424242);
    for (let i = 0; i < 100; i++) {
      const ids = Array.from({ length: rng.nextInt(1, 6) }, (_, k) => `id-${k}`);
      const inputSet = new Set(ids);
      const raw = Array.from({ length: rng.nextInt(0, 10) }, () => ({
        id: rng.nextBool() ? ids[rng.nextInt(0, ids.length - 1)] : rng.nextString(5),
        title: rng.nextString(12),
      }));
      const result = validateTocTitles(raw, inputSet);
      for (const entry of result) {
        expect(inputSet.has(entry.id)).toBe(true);
      }
    }
  });
});

describe('tableAdaptation validation', () => {
  const inputCfis = new Set(['epubcfi(/6/2)', 'epubcfi(/6/4)']);

  it('drops hallucinated CFIs, keeps real ones', () => {
    const result = validateTableAdaptations(
      [
        { cfi: 'epubcfi(/6/2)', adaptation: 'The table shows…' },
        { cfi: 'epubcfi(/666/13)', adaptation: 'hallucinated' },
      ],
      inputCfis,
    );
    expect(result).toEqual([{ cfi: 'epubcfi(/6/2)', adaptation: 'The table shows…' }]);
  });

  it('throws on shape breaches', () => {
    for (const bad of [null, {}, [{ cfi: 'x' }], [{ adaptation: 'y' }], 'nope']) {
      expect(() => validateTableAdaptations(bad, inputCfis)).toThrow(GenAIInvalidResponseError);
    }
  });
});

describe('libraryMapping validation', () => {
  const entryIds = new Set(['entry1.epub']);
  const bookIds = new Set(['book1']);

  it('regression: missing mappings array means "no matches" (legacy tolerance)', () => {
    expect(validateLibraryMappings({}, entryIds, bookIds)).toEqual([]);
  });

  it('drops pairs referencing unknown entries OR unknown books (the SmartLinkDialog keeper, generalized)', () => {
    const result = validateLibraryMappings(
      {
        mappings: [
          { readingListFilename: 'entry1.epub', libraryBookId: 'book1' },
          { readingListFilename: 'entry1.epub', libraryBookId: 'hallucinated-book' },
          { readingListFilename: 'hallucinated.epub', libraryBookId: 'book1' },
        ],
      },
      entryIds,
      bookIds,
    );
    expect(result).toEqual([{ readingListFilename: 'entry1.epub', libraryBookId: 'book1' }]);
  });

  it('throws on shape breaches', () => {
    for (const bad of [null, [], { mappings: [{ readingListFilename: 1 }] }, { mappings: 'x' }]) {
      expect(() => validateLibraryMappings(bad, entryIds, bookIds)).toThrow(
        GenAIInvalidResponseError,
      );
    }
  });

  it('regression: end-to-end mapping through the client (ex-GenAIService.test.ts Smart Link)', async () => {
    const client = new MockGenAIClient({
      response: { mappings: [{ readingListFilename: 'entry1.epub', libraryBookId: 'book1' }] },
      delayMs: 0,
    });
    const result = await mapReadingListToLibrary(
      client,
      [{ filename: 'entry1.epub', title: 'Test', author: 'Author' }],
      [{ bookId: 'book1', title: 'Test Book', author: 'Author', sourceFilename: 'other.epub' }],
    );
    expect(result).toEqual([{ readingListFilename: 'entry1.epub', libraryBookId: 'book1' }]);
  });
});
