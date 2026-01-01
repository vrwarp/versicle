import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter with Custom Abbreviations', () => {
  const createSentences = (text: string): SentenceNode[] => {
      const segmenter = new TextSegmenter();
      return segmenter.segment(text).map(s => ({ text: s.text, cfi: 'cfi' }));
  };

  it('merges segments when abbreviation is provided via refineSegments', () => {
    // "MyAbbrev." is definitely not standard.
    const text = "This is MyAbbrev. Smith is here.";

    const raw = createSentences(text);

    // If it splits:
    if (raw.length > 1) {
        // Now test with custom abbrev
        const refined = TextSegmenter.refineSegments(
            raw,
            ['MyAbbrev.'],
            [], // alwaysMerge
            [] // sentenceStarters
        );

        expect(refined).toHaveLength(1);
        expect(refined[0].text).toBe("This is MyAbbrev. Smith is here.");
    }
  });

  it('respects passed abbreviations in refineSegments', () => {
      const text = "Dr. No is a movie.";
      const raw = createSentences(text);

      const refined = TextSegmenter.refineSegments(
          raw,
          ['Dr.', 'Prof.'],
          [],
          [] // Empty sentenceStarters ensures 'No' doesn't block merge
      );

      expect(refined).toHaveLength(1);
      expect(refined[0].text).toBe("Dr. No is a movie.");
  });

  it('disables sentence starter heuristic when empty list passed to refineSegments', () => {
      // By default "Dr." + "He" splits because "He" is a starter.
      // If we pass empty sentenceStarters, it should merge (because "Dr." is an abbreviation).
      const text = "I visited the Dr. He was nice.";
      const raw = createSentences(text);

      const refined = TextSegmenter.refineSegments(
          raw,
          ['Dr.'],
          [],
          [] // Empty starters -> always merge if abbreviation found
      );

      expect(refined).toHaveLength(1);
      expect(refined[0].text.trim()).toBe("I visited the Dr. He was nice.");
  });
});
