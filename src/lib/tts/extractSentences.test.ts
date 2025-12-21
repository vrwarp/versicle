import { describe, it, expect } from 'vitest';
import { extractSentencesFromNode } from '../tts';

describe('extractSentencesFromNode inline element fragmentation', () => {
    const mockCfiGenerator = (range: Range) => `cfi(${range.startOffset})`;

    it('should NOT fragment sentences with inline elements', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p>This is a <b>test</b>.</p>';
        const result = extractSentencesFromNode(div, mockCfiGenerator);

        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('This is a test.');
    });

    it('should NOT fragment sentences split by links', () => {
         const div = document.createElement('div');
         div.innerHTML = '<p>Click <a href="#">here</a> for more.</p>';
         const result = extractSentencesFromNode(div, mockCfiGenerator);

        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('Click here for more.');
    });

    it('should handle multiple sentences in a block', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p>Sentence one. <b>Sentence</b> two.</p>';
        const result = extractSentencesFromNode(div, mockCfiGenerator);

        expect(result).toHaveLength(2);
        expect(result[0].text).toBe('Sentence one.');
        expect(result[1].text).toBe('Sentence two.');
    });

    it('should handle nested blocks correctly', () => {
         const div = document.createElement('div');
         div.innerHTML = '<div>Outer text. <p>Inner paragraph.</p> Post text.</div>';
         const result = extractSentencesFromNode(div, mockCfiGenerator);

        const texts = result.map(s => s.text);
        expect(texts).toContain('Outer text.');
        expect(texts).toContain('Inner paragraph.');
        expect(texts).toContain('Post text.');
    });
});
