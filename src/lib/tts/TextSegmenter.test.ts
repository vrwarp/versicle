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
});
