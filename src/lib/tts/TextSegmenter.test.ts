import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter', () => {
  it('handles CJK fallback regex', () => {
    // It doesn't use the CJK fallback out of the box because it uses Intl.Segmenter in Node.
    // But let's verify CJK punctuation is handled if we pass Chinese text.
    const segmenter = new TextSegmenter(); // English locale but CJK punctuation handled by Intl.Segmenter
    const chineseText = '你好。世界！这是一个测试？';
    const results = segmenter.segment(chineseText);
    expect(results.length).toBeGreaterThan(1);
  });
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

  it('automatically treats single letters as abbreviations and merges them', () => {
    const sentences: SentenceNode[] = [
      { text: "A. ", cfi: "cfi1" },
      { text: "Smith went to Washington.", cfi: "cfi2" }
    ];

    // No abbreviations passed, but "A." should be auto-merged
    const refined = TextSegmenter.refineSegments(sentences, [], [], []);

    expect(refined).toHaveLength(1);
    expect(refined[0].text).toBe("A. Smith went to Washington.");
  });

  it('automatically treats roman numerals (1-9) as abbreviations and merges them', () => {
    const sentences: SentenceNode[] = [
      { text: "Part IV. ", cfi: "cfi1" },
      { text: "The Return.", cfi: "cfi2" }
    ];

    const refined = TextSegmenter.refineSegments(sentences, [], [], []);

    expect(refined).toHaveLength(1);
    expect(refined[0].text).toBe("Part IV. The Return.");
  });

  it('does not merge single letters/roman numerals if followed by a sentence starter', () => {
    const sentences: SentenceNode[] = [
      { text: "He finished Part IV. ", cfi: "cfi1" },
      { text: "Then he rested.", cfi: "cfi2" }
    ];

    // "Then" is a default starter, so it shouldn't merge
    const refined = TextSegmenter.refineSegments(sentences, [], [], DEFAULT_SENTENCE_STARTERS);

    expect(refined).toHaveLength(2);
    expect(refined[0].text).toBe("He finished Part IV. ");
    expect(refined[1].text).toBe("Then he rested.");
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
          (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = originalSegmenter;
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

  describe('regression: NFKD normalization must not shift raw-text offsets (CFI drift on non-ASCII books)', () => {
    // segment() used to NFKD-normalize its input and return indices into the
    // normalized string. Every decomposable character (é → e+◌́, ﬁ → fi) before a
    // sentence start shifted the offsets that extractSentencesFromNode maps back
    // onto raw DOM text nodes, corrupting the persisted CFIs. The contract is:
    // index/length address the RAW input; only the outbound text is NFKD-normalized.
    const segmentAndCheckRoundTrip = (text: string) => {
      const segmenter = new TextSegmenter();
      const segments = segmenter.segment(text);
      for (const s of segments) {
        const rawSlice = text.slice(s.index, s.index + s.length);
        expect(s.text).toBe(rawSlice.normalize('NFKD'));
      }
      return segments;
    };

    it('keeps raw indices when precomposed accents (NFC é, à) precede a sentence', () => {
      const text = 'Le café est bon. Voilà le chat. Fin.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(3);
      // Pre-fix, NFKD lengthened "café"/"Voilà" so these indices were 1 and 2
      // characters too far right (18 and 34 instead of 17 and 32).
      expect(segments[1].index).toBe(text.indexOf('Voilà'));
      expect(segments[2].index).toBe(text.indexOf('Fin.'));
      expect(text.slice(segments[2].index, segments[2].index + segments[2].length)).toBe('Fin.');
    });

    it('keeps raw indices with combining-mark accents (e + U+0301)', () => {
      const text = 'Le cafe\u0301 est bon. Fin.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(2);
      expect(segments[1].index).toBe(text.indexOf('Fin.'));
    });

    it('keeps raw indices across ligatures (ﬁ) while still decomposing outbound text', () => {
      const text = 'The ﬁrst rule. The second rule.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(2);
      expect(segments[1].index).toBe(text.indexOf('The second'));
      expect(text.slice(segments[1].index, segments[1].index + segments[1].length)).toBe('The second rule.');
      // Outbound text is still NFKD-normalized: the ligature decomposes.
      expect(segments[0].text).toContain('first');
    });

    it('keeps raw indices for CJK text', () => {
      const text = '你好。世界！这是一个测试？';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments.length).toBeGreaterThan(1);
      expect(text.slice(segments[1].index, segments[1].index + segments[1].length)).toBe('世界！');
    });

    it('still normalizes the outbound segment text (nbsp → space)', () => {
      const text = 'Word1 Word2.';
      const segments = segmentAndCheckRoundTrip(text);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Word1 Word2.');
      // nbsp is length-preserving under NFKD, so raw length still matches.
      expect(segments[0].length).toBe(text.length);
    });

    describe('fallback regex path', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let originalSegmenter: any;

      beforeEach(() => {
          originalSegmenter = Intl.Segmenter;
          // @ts-expect-error - Mocking Intl.Segmenter
          Intl.Segmenter = undefined;
      });

      afterEach(() => {
          (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = originalSegmenter;
      });

      it('keeps raw indices and normalizes outbound text', () => {
          const segmenter = new TextSegmenter();
          const text = 'Le café est bon. Fin.';
          const segments = segmenter.segment(text);

          expect(segments).toHaveLength(2);
          for (const s of segments) {
              const rawSlice = text.slice(s.index, s.index + s.length);
              expect(s.text).toBe(rawSlice.normalize('NFKD'));
          }
          expect(segments[1].index).toBe(text.indexOf(' Fin.'));
      });
    });
  });
});
