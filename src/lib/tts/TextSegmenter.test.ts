import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

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

  it('handles abbreviations like Mr. Smith correctly', () => {
    const segmenter = new TextSegmenter('en', ['Mr.']);
    const text = "Mr. Smith went to Washington.";
    const segments = segmenter.segment(text);

    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Mr. Smith went to Washington.");
  });

  it('handles empty input', () => {
    const segmenter = new TextSegmenter();
    expect(segmenter.segment("")).toHaveLength(0);
  });

  it('merges default ALWAYS_MERGE titles even if abbreviations list is empty', () => {
    const segmenter = new TextSegmenter();
    const text = "Mr. Smith went home.";
    const segments = segmenter.segment(text);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Mr. Smith went home.");
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
