import { describe, it, expect } from 'vitest';
import { TextSegmenter, DEFAULT_ALWAYS_MERGE } from './TextSegmenter';

describe('TextSegmenter - Punctuation Handling', () => {
    const segmenter = new TextSegmenter('en', [], DEFAULT_ALWAYS_MERGE);

    it('should handle abbreviations inside parentheses', () => {
        const text = 'I met (Mr. Smith) yesterday.';
        const segments = segmenter.segment(text);
        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe('I met (Mr. Smith) yesterday.');
    });

    it('should handle abbreviations inside brackets', () => {
        const text = 'I met [Mr. Smith] yesterday.';
        const segments = segmenter.segment(text);
        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe('I met [Mr. Smith] yesterday.');
    });

    it('should handle abbreviations inside double quotes', () => {
        const text = 'I met "Mr. Smith" yesterday.';
        const segments = segmenter.segment(text);
        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe('I met "Mr. Smith" yesterday.');
    });

    it('should handle abbreviations inside single quotes', () => {
        const text = "I met 'Mr. Smith' yesterday.";
        const segments = segmenter.segment(text);
        expect(segments).toHaveLength(1);
        expect(segments[0].text).toBe("I met 'Mr. Smith' yesterday.");
    });
});
