import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import { TextSegmenter } from './TextSegmenter';
import { LexiconRule } from '../../types/db';

// Mock getDB for LexiconService
vi.mock('../../db/db', () => ({
  getDB: vi.fn(),
}));

describe('Normalization (NFKD)', () => {
  describe('LexiconService Normalization', () => {
    let service: LexiconService;

    beforeEach(() => {
      service = LexiconService.getInstance();
    });

    it('should normalize non-breaking spaces (nbsp) to standard spaces in applyLexicon', () => {
      const nbsp = '\u00A0';
      const text = `Hello${nbsp}World`;
      const rules: LexiconRule[] = [
        { id: '1', original: 'Hello World', replacement: 'Greetings', created: 0 }
      ];

      // "Hello World" rule should match "Hello&nbsp;World" because text is normalized to "Hello World"
      expect(service.applyLexicon(text, rules)).toBe('Greetings');
    });

    it('should normalize rule original and replacement strings', async () => {
      const db = {
        put: vi.fn(),
      };
      const { getDB } = await import('../../db/db');
      vi.mocked(getDB).mockResolvedValue(db as unknown as IDBDatabase);

      const nbsp = '\u00A0';
      const rule = {
        original: `Hello${nbsp}World`,
        replacement: `Good${nbsp}Day`,
      };

      await service.saveRule(rule);

      expect(db.put).toHaveBeenCalledWith('lexicon', expect.objectContaining({
        original: 'Hello World',
        replacement: 'Good Day',
      }));
    });

    it('should normalize decomposition characters', () => {
      // 'e' + combining acute accent
      const decomposed = 'e\u0301';
      // 'é' (U+00E9)
      const composed = '\u00E9';

      const rules: LexiconRule[] = [
        { id: '1', original: 'caf' + composed, replacement: 'place', created: 0 }
      ];

      const text = 'caf' + decomposed;
      // Should match regardless of form because both normalize to decomposed in NFKD?
      // Actually NFKD decomposes, so composed \u00E9 becomes e\u0301.
      // So both side become e\u0301.

      expect(service.applyLexicon(text, rules)).toBe('place');
    });
  });

  describe('TextSegmenter Normalization', () => {
    it('should normalize input text before segmentation', () => {
      const nbsp = '\u00A0';
      const text = `Sentence 1.${nbsp}Sentence 2.`;

      const segmenter = new TextSegmenter();
      const segments = segmenter.segment(text);

      expect(segments).toHaveLength(2);

      // Node's Intl.Segmenter might include the space in the first segment
      // "Sentence 1. "
      const segment1 = segments[0].text;
      const segment2 = segments[1].text;

      if (segment1.trim() === 'Sentence 1.') {
        // Check if the trailing character is a space (0x20)
        expect(segment1).toMatch(/Sentence 1\.[ ]?/);
        expect(segment1).not.toContain(nbsp);
      } else {
         // Fallback expectation if segmentation behaves differently
         expect(segment1).toContain('Sentence 1.');
      }

      expect(segment2.trim()).toBe('Sentence 2.');

      // Let's try a case where the space is inside the sentence
      const textInside = `Word1${nbsp}Word2.`;
      const segmentsInside = segmenter.segment(textInside);
      expect(segmentsInside[0].text).toBe('Word1 Word2.');
      expect(segmentsInside[0].text).not.toContain(nbsp);
    });

    it('should normalize text in refineSegments', () => {
        const nbsp = '\u00A0';
        const sentences = [
            { text: `Sentence${nbsp}1.`, cfi: 'cfi1' },
            { text: `Sentence${nbsp}2.`, cfi: 'cfi2' }
        ];

        const refined = TextSegmenter.refineSegments(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sentences as any,
            [],
            [],
            []
        );

        expect(refined[0].text).toBe('Sentence 1.');
        expect(refined[0].text).not.toContain(nbsp);
        expect(refined[1].text).toBe('Sentence 2.');
    });

    it('should handle matching normalized abbreviations in refineSegments', () => {
        const nbsp = '\u00A0';
        const abbrWithNbsp = `Mr${nbsp}.`; // "Mr ."

        // Input text has normal space
        const sentences = [
            { text: "Mr .", cfi: 'cfi1' },
            { text: "Smith.", cfi: 'cfi2' }
        ];

        // Pass abbreviation with nbsp
        const refined = TextSegmenter.refineSegments(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sentences as any,
            [abbrWithNbsp], // ["Mr ."]
            [abbrWithNbsp], // always merge
            []
        );

        // Should merge because "Mr ." (from text) matches "Mr ." (from normalized abbr)
        expect(refined).toHaveLength(1);
        expect(refined[0].text).toBe('Mr . Smith.');
    });
  });
});
