import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter', () => {
  it('segments simple sentences correctly using Intl.Segmenter', () => {
    const segmenter = new TextSegmenter();
    const text = "Hello world. This is a test.";
    const segments = segmenter.segment(text);

    expect(segments).toHaveLength(2);
    // Intl.Segmenter usually includes trailing spaces
    expect(segments[0].text).toBe("Hello world. ");
    expect(segments[1].text).toBe("This is a test.");
  });

  it('splits abbreviations like Mr. Smith in raw segmentation', () => {
    const segmenter = new TextSegmenter('en');
    const text = "Mr. Smith went to Washington.";
    const segments = segmenter.segment(text);

    // Raw segmentation splits at "Mr."
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].text.trim()).toBe("Mr.");
  });

  it('can refine abbreviations via refineSegments', () => {
    // Construct sentences simulating raw split (space attached to first segment)
    const sentences: SentenceNode[] = [
      { text: "Mr. ", cfi: "cfi1" },
      { text: "Smith went to Washington.", cfi: "cfi2" }
    ];

    const refined = TextSegmenter.refineSegments(
      sentences,
      ['Mr.'],
      DEFAULT_ALWAYS_MERGE,
      DEFAULT_SENTENCE_STARTERS
    );

    expect(refined).toHaveLength(1);
    expect(refined[0].text).toBe("Mr. Smith went to Washington.");
  });

  it('handles empty input', () => {
    const segmenter = new TextSegmenter();
    expect(segmenter.segment("")).toHaveLength(0);
  });

  describe('Fallback behavior', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let originalSegmenter: any;

      beforeEach(() => {
          originalSegmenter = Intl.Segmenter;
          // @ts-expect-error - Mocking Intl.Segmenter
          Intl.Segmenter = undefined;
      });

      afterEach(() => {
          Intl.Segmenter = originalSegmenter;
      });

      it('segments using fallback regex when Intl.Segmenter is missing', () => {
          const segmenter = new TextSegmenter();

          const text = "Hello world. This is a test.";
          const segments = segmenter.segment(text);

          expect(segments).toHaveLength(2);
          // Fallback logic splits differently regarding whitespace
          expect(segments[0].text).toBe("Hello world.");
          expect(segments[1].text).toBe(" This is a test.");
      });

      it('fails on Mr. Smith with fallback regex', () => {
          const segmenter = new TextSegmenter();
          const text = "Mr. Smith went to Washington.";
          const segments = segmenter.segment(text);

          // Regex will split at "Mr."
          expect(segments.length).toBeGreaterThan(1);
          expect(segments[0].text).toBe("Mr.");
      });
  });

  describe('Manual Scanning Helpers (via refineSegments)', () => {
      it('handles Unicode whitespace correctly', () => {
          // "Mr." followed by Em Space (U+2003) and "Smith"
          const sentences: SentenceNode[] = [
              { text: "Hello Mr.\u2003", cfi: "1" },
              { text: "Smith went.", cfi: "2" }
          ];
          const abbreviations = ['Mr.'];
          const refined = TextSegmenter.refineSegments(
              sentences,
              abbreviations,
              [],
              []
          );

          // Should be merged because "Mr." is identified correctly despite Em Space
          expect(refined).toHaveLength(1);
          expect(refined[0].text).toContain("Mr.\u2003 Smith");
      });
  });

  describe('Merging Reliability', () => {
    it('should not add a leading dot when merging into a whitespace-only segment', () => {
        // Simulating a case where the first segment is just whitespace or empty
        // which might happen with some PDF text extractions or weird formatting
        const segments = [
            { text: '   ', cfi: 'cfi1', index: 0, length: 3 },
            { text: 'Hello world.', cfi: 'cfi2', index: 3, length: 12 }
        ];

        // Using mergeByLength with a minLength > 3 to force merge
        const merged = TextSegmenter.mergeByLength(segments, 10);

        expect(merged.length).toBe(1);
        expect(merged[0].text.trim()).toBe('Hello world.');
        expect(merged[0].text).not.toContain('. Hello');
    });

    it('should handle empty first segment gracefully', () => {
        const segments = [
            { text: '', cfi: 'cfi1', index: 0, length: 0 },
            { text: 'Start.', cfi: 'cfi2', index: 0, length: 6 }
        ];

        const merged = TextSegmenter.mergeByLength(segments, 5);
        expect(merged.length).toBe(1);
        expect(merged[0].text).toBe('Start.');
    });
  });
});
