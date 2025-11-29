import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

describe('TextSegmenter Bug Reproduction', () => {
    it('incorrectly merges sentences when the first one ends with an abbreviation', () => {
        const segmenter = new TextSegmenter('en', ['U.S.']);
        const text = "I live in the U.S. Then I moved.";

        const segments = segmenter.segment(text);

        expect(segments).toHaveLength(2);
        expect(segments[0].text.trim()).toBe("I live in the U.S.");
        expect(segments[1].text.trim()).toBe("Then I moved.");
    });

    it('correctly merges when abbreviation is not end of sentence', () => {
        const segmenter = new TextSegmenter('en', ['Mr.']);
        const text = "Mr. Smith is here.";
        const segments = segmenter.segment(text);

        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe("Mr. Smith is here.");
    });

    it('handles ambiguous abbreviations like St.', () => {
        const segmenter = new TextSegmenter('en', ['St.']);

        // Case 1: St. Paul (Merge)
        const text1 = "I visited St. Paul.";
        const segments1 = segmenter.segment(text1);
        expect(segments1).toHaveLength(1);
        expect(segments1[0].text).toBe("I visited St. Paul.");

        // Case 2: Main St. Then (Split)
        const text2 = "I went to Main St. Then I left.";
        const segments2 = segmenter.segment(text2);
        expect(segments2).toHaveLength(2);
        expect(segments2[0].text.trim()).toBe("I went to Main St.");
        expect(segments2[1].text.trim()).toBe("Then I left.");
    });

    it('merges U.S. Congress (not a sentence starter)', () => {
        const segmenter = new TextSegmenter('en', ['U.S.']);
        const text = "The U.S. Congress met.";
        const segments = segmenter.segment(text);
        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe("The U.S. Congress met.");
    });
});
