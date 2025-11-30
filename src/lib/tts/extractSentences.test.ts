import { describe, it, expect, vi } from 'vitest';
import { extractSentences } from '../tts';

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            customAbbreviations: ['Mr.', 'Mrs.', 'Dr.']
        })),
    }
}));

// Mock ePub.js structures
class MockRendition {
    document: Document;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contents: any[];

    constructor(doc: Document) {
        this.document = doc;
        this.contents = [{
            document: doc,
            cfiFromRange: (range: Range) => `cfi(${range.startOffset})`
        }];
    }

    getContents() {
        return this.contents;
    }
}

describe('extractSentences inline element fragmentation', () => {
    it('should NOT fragment sentences with inline elements', () => {
        // Setup DOM with inline element
        const dom = new DOMParser().parseFromString(
            '<p>This is a <b>test</b>.</p>',
            'text/html'
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rendition = new MockRendition(dom) as any;

        const sentences = extractSentences(rendition);

        // Desired behavior (fix):
        // 1. "This is a test."

        expect(sentences).toHaveLength(1);
        expect(sentences[0].text).toBe('This is a test.');
    });

    it('should NOT fragment sentences split by links', () => {
         // Setup DOM with link
         const dom = new DOMParser().parseFromString(
            '<p>Click <a href="#">here</a> for more.</p>',
            'text/html'
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rendition = new MockRendition(dom) as any;

        const sentences = extractSentences(rendition);

        expect(sentences).toHaveLength(1);
        expect(sentences[0].text).toBe('Click here for more.');
    });

    it('should handle multiple sentences in a block', () => {
        const dom = new DOMParser().parseFromString(
            '<p>Sentence one. <b>Sentence</b> two.</p>',
            'text/html'
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rendition = new MockRendition(dom) as any;
        const sentences = extractSentences(rendition);

        expect(sentences).toHaveLength(2);
        expect(sentences[0].text).toBe('Sentence one.');
        expect(sentences[1].text).toBe('Sentence two.');
    });

    it('should handle nested blocks correctly', () => {
         const dom = new DOMParser().parseFromString(
            '<div>Outer text. <p>Inner paragraph.</p> Post text.</div>',
            'text/html'
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rendition = new MockRendition(dom) as any;
        const sentences = extractSentences(rendition);

        // "Outer text. " -> 1
        // "Inner paragraph." -> 1
        // " Post text." -> 1

        // Note: The "Post text." might depend on segmenter handling of leading space.
        // TextSegmenter trims.

        expect(sentences.length).toBeGreaterThanOrEqual(3);
        expect(sentences.map(s => s.text)).toContain('Outer text.');
        expect(sentences.map(s => s.text)).toContain('Inner paragraph.');
        expect(sentences.map(s => s.text)).toContain('Post text.');
    });
});
