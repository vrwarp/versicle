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

      expect(service.applyLexicon(text, rules)).toBe('Greetings');
    });

    it('should normalize rule original and replacement strings', async () => {
      // Mock DB with transaction for saveRule (v18 uses tx)
      const mockPut = vi.fn();
      const db = {
        transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue(undefined), // No existing overrides
                put: mockPut
            }),
            done: Promise.resolve()
        })
      };

      const { getDB } = await import('../../db/db');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(getDB).mockResolvedValue(db as any);

      const nbsp = '\u00A0';
      const rule = {
        original: `Hello${nbsp}World`,
        replacement: `Good${nbsp}Day`,
      };

      await service.saveRule(rule);

      // Verify normalization happened in the saved object
      // saveRule saves UserOverrides object.
      expect(db.transaction).toHaveBeenCalledWith('user_overrides', 'readwrite');
      expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({
          lexicon: expect.arrayContaining([
              expect.objectContaining({
                  original: 'Hello World',
                  replacement: 'Good Day'
              })
          ])
      }));
    });

    it('should normalize decomposition characters', () => {
      const decomposed = 'e\u0301';
      const composed = '\u00E9';

      const rules: LexiconRule[] = [
        { id: '1', original: 'caf' + composed, replacement: 'place', created: 0 }
      ];

      const text = 'caf' + decomposed;
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

      const segment1 = segments[0].text;
      const segment2 = segments[1].text;

      if (segment1.trim() === 'Sentence 1.') {
        expect(segment1).toMatch(/Sentence 1\.[ ]?/);
        expect(segment1).not.toContain(nbsp);
      } else {
         expect(segment1).toContain('Sentence 1.');
      }

      expect(segment2.trim()).toBe('Sentence 2.');

      const textInside = `Word1${nbsp}Word2.`;
      const segmentsInside = segmenter.segment(textInside);
      expect(segmentsInside[0].text).toBe('Word1 Word2.');
      expect(segmentsInside[0].text).not.toContain(nbsp);
    });

    it('should assume normalized text in refineSegments (optimization contract)', () => {
        const nbsp = '\u00A0';
        const sentences = [
            { text: `Sentence${nbsp}1.`.normalize('NFKD'), cfi: 'cfi1' },
            { text: `Sentence${nbsp}2.`.normalize('NFKD'), cfi: 'cfi2' }
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
        const abbrWithNbsp = `Mr${nbsp}.`;

        const sentences = [
            { text: "Mr .", cfi: 'cfi1' },
            { text: "Smith.", cfi: 'cfi2' }
        ];

        const refined = TextSegmenter.refineSegments(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sentences as any,
            [abbrWithNbsp],
            [abbrWithNbsp],
            []
        );

        expect(refined).toHaveLength(1);
        expect(refined[0].text).toBe('Mr . Smith.');
    });
  });
});
