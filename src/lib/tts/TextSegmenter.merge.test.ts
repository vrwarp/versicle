
import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter.mergeByLength', () => {
    const createNode = (text: string, cfi: string = ''): SentenceNode => ({
        text,
        cfi,
        index: 0,
        length: text.length
    });

    it('should return empty list for empty input', () => {
        expect(TextSegmenter.mergeByLength([], 10)).toEqual([]);
    });

    it('should return original list if all sentences are long enough', () => {
        const sentences = [
            createNode('This is a sufficiently long sentence.'),
            createNode('This is another long sentence.')
        ];
        expect(TextSegmenter.mergeByLength(sentences, 10)).toHaveLength(2);
        expect(TextSegmenter.mergeByLength(sentences, 10)[0].text).toBe(sentences[0].text);
    });

    it('should merge short sentence into next one', () => {
        const sentences = [
            createNode('Hi.'),
            createNode('This is a longer sentence.')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 10);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Hi. This is a longer sentence.');
    });

    it('should merge multiple consecutive short sentences', () => {
        const sentences = [
            createNode('A.'),
            createNode('B.'),
            createNode('C.'),
            createNode('Longer end sentence.')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 10);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('A. B. C. Longer end sentence.');
    });

    it('should push buffer if it accumulates enough length', () => {
        const sentences = [
            createNode('One.'),
            createNode('Two.'),
            createNode('Three four five.'), // 16 chars
            createNode('Six.')
        ];
        // Expected Logic:
        // 1. "One." (len 4) -> Buffer
        // 2. "One. Two." (len 9) < 10 -> Buffer
        // 3. "One. Two. Three four five." (len 25) >= 10 -> Push to results
        // 4. "Six." (len 4) < 10 -> Buffer
        // End: "Six." is too short, so it merges backward into the last result.
        // Final Result: "One. Two. Three four five. Six."

        const result = TextSegmenter.mergeByLength(sentences, 10);

        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('One. Two. Three four five. Six.');
    });

     it('should handle middle merges correctly', () => {
        const sentences = [
            createNode('First long sentence.'),
            createNode('Short.'),
            createNode('Second long sentence.')
        ];
        // Expected Logic:
        // 1. "First long sentence." (len > 10) -> Push to results
        // 2. "Short." (len < 10) -> Buffer
        // 3. "Short. Second long sentence." (len > 10) -> Push to results

        const result = TextSegmenter.mergeByLength(sentences, 10);
        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('First long sentence.');
        expect(result[1].text).toBe('Short. Second long sentence.');
    });

    it('should merge last trailing short sentence backward', () => {
        const sentences = [
            createNode('This is a long sentence.'),
            createNode('Short.')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 10);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('This is a long sentence. Short.');
    });

    it('should return the short sentence if it is the only one', () => {
        const sentences = [createNode('Hi.')];
        const result = TextSegmenter.mergeByLength(sentences, 10);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Hi.');
    });

    it('should insert a period when merging segments without punctuation', () => {
        const sentences = [
            createNode('Title'),
            createNode('Subtitle')
        ];
        // minLength 100 to force merge
        const result = TextSegmenter.mergeByLength(sentences, 100);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Title. Subtitle');
    });

    it('should not insert double periods if punctuation exists', () => {
        const sentences = [
            createNode('Title.'),
            createNode('Subtitle')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 100);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Title. Subtitle');
    });

    it('should respect other punctuation', () => {
        const sentences = [
            createNode('Title!'),
            createNode('Subtitle')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 100);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Title! Subtitle');
    });

    it('should insert period in backward merge if missing', () => {
        const sentences = [
            createNode('Long sentence here'), // No period
            createNode('Short')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 10);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Long sentence here. Short');
    });

    it('should handle chain of merges with periods', () => {
        const sentences = [
            createNode('A'),
            createNode('B'),
            createNode('C')
        ];
        const result = TextSegmenter.mergeByLength(sentences, 100);
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('A. B. C');
    });
});
