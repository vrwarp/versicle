import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LexiconService } from './LexiconService';
import { TextSegmenter } from './TextSegmenter';
import { LexiconRule } from '../../types/db';

// Mock DB (not used directly anymore but safe to mock)
vi.mock('../../db/db', () => ({
  getDB: vi.fn(),
}));

// Mock store and sync
vi.mock('../../store/useLexiconStore', () => ({
  useLexiconStore: {
    getState: vi.fn(),
  }
}));

vi.mock('../../store/yjs-provider', () => ({
  waitForYjsSync: vi.fn().mockResolvedValue(),
}));

// Mock TTS Store for Bible preference check
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: () => ({ isBibleLexiconEnabled: false })
  }
}));


describe('Normalization (NFKD)', () => {
  describe('LexiconService Normalization', () => {
    let service: LexiconService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockStore: any;

    beforeEach(async () => {
      service = LexiconService.getInstance();

      mockStore = {
        rules: {},
        settings: {},
        addRule: vi.fn(),
        updateRule: vi.fn(),
        deleteRule: vi.fn(),
        deleteRules: vi.fn(),
      };

      const { useLexiconStore } = await import('../../store/useLexiconStore');
      vi.mocked(useLexiconStore.getState).mockReturnValue(mockStore);
    });

    it('should normalize non-breaking spaces (nbsp) to standard spaces in applyLexicon', () => {
      const nbsp = '\u00A0';
      const text = `Hello${nbsp}World`;
      const rules: LexiconRule[] = [
        { id: '1', original: 'Hello World', replacement: 'Greetings', created: 0 }
      ];

      expect(service.applyLexicon(text, rules)).toBe('Greetings');
    });

    it('should normalize rule original and replacement strings before saving', async () => {
      const nbsp = '\u00A0';
      const rule = {
        original: `Hello${nbsp}World`,
        replacement: `Good${nbsp}Day`,
      };

      await service.saveRule(rule);

      // Verify normalization happened before calling store
      // The Service doesn't actually normalize *before* saving in the current implementation?
      // Let's check LexiconService.ts implementation or behavior.
      // applyLexicon normalizes on the fly. 
      // But usually we prefer to normalize data on input.
      // If the Service *doesn't* normalize on save, this test will fail if we expect it to.
      // However, normalizing on save is good practice.
      // The previous test verified it calling DB with normalized data.
      // Let's verify if 'addRule' is called with normalized data.
      // If LexiconService.ts doesn't normalize, we might need to add it or update expectation.
      // Wait, LexiconService.saveRule DOES NOT normalize in current code view!
      // The previous implementation must have had it.
      // I should probably skip this test or fix LexiconService to normalize?
      // Ensuring normalization is valuable. I will update this test to expect call,
      // and if it fails, I will fix Service.

      // Let's assume for now we want this behavior.
      // Use expect.stringMatching or similar if implementation is unsure,
      // but strict equality is better.
      // NOTE: Original legacy test expected normalization. Use legacy behavior?
      // Legacy Code: "expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({ original: 'Hello World' }))"

      // I'll leave the expectation strict.
      // If it fails, I'll update LexiconService.saveRule to normalize.

      // Re-reading Legacy LexiconService.ts (not visible here but inferred from test):
      // The test passed before, so logic existed.
      // I should restore it in saveRule.

      expect(mockStore.addRule).toHaveBeenCalledWith(expect.objectContaining({
        original: 'Hello World',
        replacement: 'Good Day'
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
    // These tests don't depend on DB/Store, just pure logic.
    // They can stay as is, just copy logic since I'm rewriting file.

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
