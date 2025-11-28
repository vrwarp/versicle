import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

describe('TextSegmenter', () => {
    it('segments simple sentences correctly using fallback or Intl', () => {
        const segmenter = new TextSegmenter('en');
        const text = "Hello world. This is a test.";
        const segments = segmenter.segment(text);

        expect(segments.length).toBeGreaterThanOrEqual(2);
        expect(segments[0].text).toContain("Hello world");
        expect(segments[1].text).toContain("This is a test");
    });

    it('segments complex sentences with Intl if available', () => {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new TextSegmenter('en');
            // Using "This is another example." to ensure Intl splits it, unlike "e.g." which Node v22 keeps attached.
            const text = "Mr. Smith went to Washington. This is another example.";
            const segments = segmenter.segment(text);

            // "Mr. " should merge with "Smith went to Washington. "
            // "This is another example." should be separate.

            expect(segments.length).toBe(2);
            expect(segments[0].text).toContain("Mr. Smith went to Washington.");
            expect(segments[1].text).toContain("This is another example.");
        }
    });

    it('merges abbreviations at end of segment', () => {
        // Explicitly test the merge logic with a mock if we could, but here we rely on known Intl behavior or fallback.
        // Let's use a string that fallback regex would definitely split, and check merge.
        // Fallback regex splits on ".", so "Mr. Smith" becomes "Mr." and "Smith".

        // Temporarily force fallback behavior by passing a dummy locale? No, can't easily disable Intl if present.
        // But the class logic applies to both.

        const segmenter = new TextSegmenter('en');
        const text = "Dr. Jones is here.";
        const segments = segmenter.segment(text);

        // Intl splits "Dr. " and "Jones is here." -> Merges to "Dr. Jones is here." (1 segment)
        // Regex splits "Dr." and " Jones is here." -> Merges to "Dr. Jones is here." (1 segment)

        expect(segments.length).toBe(1);
        expect(segments[0].text).toContain("Dr. Jones is here");
    });

    it('handles text without punctuation at end', () => {
        const segmenter = new TextSegmenter('en');
        const text = "Hello world";
        const segments = segmenter.segment(text);
        expect(segments.length).toBe(1);
        expect(segments[0].text).toBe("Hello world");
    });

    it('returns correct indices', () => {
        const segmenter = new TextSegmenter('en');
        const text = "One. Two.";
        const segments = segmenter.segment(text);
        expect(segments[0].index).toBe(0);

        // If "One. " is first segment, second starts at 5.
        // If "One." is first (regex), second starts at 5 (due to space).
        if (segments.length > 1) {
             // We can check if index is correct relative to input
             const secondSeg = segments[1];
             expect(text.substring(secondSeg.index)).toMatch(/^Two/);
        }
    });
});
