
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
        // min 10
        // "One." (4)
        // "One. Two." (9) -> Still < 10
        // "One. Two. Three four five." (25) -> Push
        // "Six." (4) -> End -> Merge back into previous

        const result = TextSegmenter.mergeByLength(sentences, 10);

        // Wait, let's trace the loop logic carefully.
        // i=0: buffer="One."
        // i=1: buffer < 10? Yes. buffer="One. Two."
        // i=2: buffer < 10? Yes (9 < 10). buffer="One. Two. Three four five."
        // i=3: buffer < 10? No (25 >= 10). push buffer. buffer="Six."
        // End loop.
        // buffer="Six." (4 < 10). Merge back into last pushed.

        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('One. Two. Three four five. Six.');
    });

     it('should handle middle merges correctly', () => {
        const sentences = [
            createNode('First long sentence.'),
            createNode('Short.'),
            createNode('Second long sentence.')
        ];
        // min 10
        // i=0: buffer="First..."
        // i=1: buffer < 10? No. Push "First...". buffer="Short."
        // i=2: buffer < 10? Yes. buffer="Short. Second..."
        // End.
        // Push buffer "Short. Second..."

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
});
