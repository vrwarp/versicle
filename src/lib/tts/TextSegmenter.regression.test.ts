import { describe, it, expect } from 'vitest';
import { TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter Regression Tests', () => {
    // Helper to simulate raw segmentation
    const createSentences = (text: string): SentenceNode[] => {
        const segmenter = new TextSegmenter();
        return segmenter.segment(text).map(s => ({ text: s.text, cfi: 'cfi' }));
    };

    it('does NOT merge distinct sentences ending in an ambiguous abbreviation (Dr.)', () => {
        const text = "I visited the Dr. He was nice.";
        const raw = createSentences(text);

        const refined = TextSegmenter.refineSegments(
            raw,
            ['Dr.'],
            DEFAULT_ALWAYS_MERGE,
            DEFAULT_SENTENCE_STARTERS
        );

        // "He" is a sentence starter, so it should split (or remain split).
        expect(refined).toHaveLength(2);
        expect(refined[0].text.trim()).toBe("I visited the Dr.");
        expect(refined[1].text.trim()).toBe("He was nice.");
    });

    it('merges sentences when abbreviation is followed by a proper noun', () => {
        const text = "I saw Dr. Smith.";
        // Ensure raw splits it first (Intl.Segmenter might handle Dr., but let's assume it doesn't or force it if needed)
        // If raw has 1 segment, this test is trivial.
        const raw = createSentences(text);

        const refined = TextSegmenter.refineSegments(
            raw,
            ['Dr.'],
            DEFAULT_ALWAYS_MERGE,
            DEFAULT_SENTENCE_STARTERS
        );

        // "Smith" is NOT a sentence starter, so it should merge.
        expect(refined).toHaveLength(1);
        expect(refined[0].text.trim()).toBe("I saw Dr. Smith.");
    });

    it('always merges known titles (Mr.) regardless of next word', () => {
        const text = "Mr. He was there.";
        const raw = createSentences(text);

        const refined = TextSegmenter.refineSegments(
            raw,
            ['Mr.'],
            DEFAULT_ALWAYS_MERGE,
            DEFAULT_SENTENCE_STARTERS
        );

        expect(refined).toHaveLength(1);
        expect(refined[0].text.trim()).toBe("Mr. He was there.");
    });

    it('does NOT merge custom abbreviation if followed by sentence starter', () => {
        const text = "This is MyAbbrev. It works.";
        const raw = createSentences(text);

        const refined = TextSegmenter.refineSegments(
            raw,
            ['MyAbbrev.'],
            DEFAULT_ALWAYS_MERGE,
            DEFAULT_SENTENCE_STARTERS
        );

        // "It" is starter. Split.
        expect(refined).toHaveLength(2);
        expect(refined[0].text.trim()).toBe("This is MyAbbrev.");
        expect(refined[1].text.trim()).toBe("It works.");
    });

    it('handles contractions correctly', () => {
        const text = "I visited the Dr. It's time to go.";
        const raw = createSentences(text);

        const refined = TextSegmenter.refineSegments(
            raw,
            ['Dr.'],
            DEFAULT_ALWAYS_MERGE,
            DEFAULT_SENTENCE_STARTERS
        );

        // "It's" is starter. Split.
        expect(refined).toHaveLength(2);
        expect(refined[0].text.trim()).toBe("I visited the Dr.");
        expect(refined[1].text.trim()).toBe("It's time to go.");
    });
});
