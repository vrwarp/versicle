import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';

describe('TextSegmenter Regression Tests', () => {
    it('does NOT merge distinct sentences ending in an ambiguous abbreviation (Dr.)', () => {
        // "Dr." is in default abbreviations.
        const segmenter = new TextSegmenter('en', ['Dr.']);
        const text = "I visited the Dr. He was nice.";
        const segments = segmenter.segment(text);

        // "He" is a sentence starter, so it should split.
        expect(segments).toHaveLength(2);
        expect(segments[0].text.trim()).toBe("I visited the Dr.");
        expect(segments[1].text.trim()).toBe("He was nice.");
    });

    it('merges sentences when abbreviation is followed by a proper noun', () => {
        const segmenter = new TextSegmenter('en', ['Dr.']);
        const text = "I saw Dr. Smith.";
        const segments = segmenter.segment(text);

        // "Smith" is NOT a sentence starter, so it should merge.
        expect(segments).toHaveLength(1);
        expect(segments[0].text.trim()).toBe("I saw Dr. Smith.");
    });

    it('always merges known titles (Mr.) regardless of next word', () => {
        const segmenter = new TextSegmenter('en', ['Mr.']);
        // "He" is a sentence starter, but "Mr." is ALWAYS_MERGE.
        // Usually "Mr. He" implies "Mr." is a title for "He" (name).
        const text = "Mr. He was there.";
        const segments = segmenter.segment(text);

        expect(segments).toHaveLength(1);
        expect(segments[0].text.trim()).toBe("Mr. He was there.");
    });

    it('does NOT merge custom abbreviation if followed by sentence starter', () => {
        const segmenter = new TextSegmenter('en', ['MyAbbrev.']);
        const text = "This is MyAbbrev. It works.";
        const segments = segmenter.segment(text);

        // "It" is starter. Split.
        expect(segments).toHaveLength(2);
        expect(segments[0].text.trim()).toBe("This is MyAbbrev.");
        expect(segments[1].text.trim()).toBe("It works.");
    });

    it('handles contractions correctly', () => {
        const segmenter = new TextSegmenter('en', ['Dr.']);
        const text = "I visited the Dr. It's time to go.";
        const segments = segmenter.segment(text);

        // "It's" is starter. Split.
        expect(segments).toHaveLength(2);
        expect(segments[0].text.trim()).toBe("I visited the Dr.");
        expect(segments[1].text.trim()).toBe("It's time to go.");
    });
});
