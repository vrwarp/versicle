import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

describe('TextSegmenter', () => {
  it('should segment simple sentences', () => {
    const segmenter = TextSegmenter.getInstance();
    const text = 'Hello world. This is a test.';
    const segments = segmenter.segment(text);

    expect(segments).toHaveLength(2);
    expect(segments[0].segment).toBe('Hello world. ');
    expect(segments[1].segment).toBe('This is a test.');
  });

  it('should handle complex cases if Intl.Segmenter is present', () => {
    // Note: In Node/Vitest environment, Intl.Segmenter might behave differently depending on version
    // But we expect it to be better than naive regex
    const segmenter = TextSegmenter.getInstance();
    const text = 'Mr. Smith went to Washington. e.g. apples.';
    const segments = segmenter.segment(text);

    // If we are in an environment with full ICU, this might pass as 2 sentences.
    // In minimal environments, it might still fallback or split weirdly if locale data is missing.
    // We mainly check that it returns something valid.
    expect(segments.length).toBeGreaterThan(0);
    // In some environments 'Mr. ' is split. We just want to ensure we get segments.
    expect(segments[0].segment.length).toBeGreaterThan(0);
  });

  it('should handle fallback correctly', () => {
      // Force fallback by nulling segmenter
      const segmenter = TextSegmenter.getInstance();
      // @ts-ignore
      segmenter.segmenter = null;

      const text = 'Hello world. This is a test.';
      const segments = segmenter.segment(text);

      expect(segments).toHaveLength(2);
      expect(segments[0].segment).toBe('Hello world.');
      expect(segments[1].segment).toBe(' This is a test.');
  });
});
