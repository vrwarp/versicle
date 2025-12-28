import { describe, it, expect } from 'vitest';
import { TextSegmenter } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter.refineSegments', () => {
    it('should merge segments based on abbreviations', () => {
        const sentences: SentenceNode[] = [
            { text: 'Mr.', cfi: 'epubcfi(/6/2!/4/1,:0,:3)' },
            { text: 'Smith goes to Washington.', cfi: 'epubcfi(/6/2!/4/1,:3,:28)' }
        ];

        const abbreviations = ['Mr.'];
        const alwaysMerge: string[] = [];
        const sentenceStarters: string[] = [];

        const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, sentenceStarters);

        expect(refined).toHaveLength(1);
        expect(refined[0].text).toBe('Mr. Smith goes to Washington.');
        // Expected CFI logic:
        // rawStart: /6/2!/4/1:0
        // rawEnd: /6/2!/4/1:28
        // common: /6/2!/4/1
        // result: epubcfi(/6/2!/4/1,:0,:28)
        expect(refined[0].cfi).toBe('epubcfi(/6/2!/4/1,:0,:28)');
    });

    it('should NOT merge if abbreviation is not in list', () => {
        const sentences: SentenceNode[] = [
            { text: 'Mr.', cfi: 'epubcfi(/6/2!/4/1,:0,:3)' },
            { text: 'Smith.', cfi: 'epubcfi(/6/2!/4/1,:3,:9)' }
        ];

        const abbreviations: string[] = []; // Empty
        const refined = TextSegmenter.refineSegments(sentences, abbreviations, [], []);

        expect(refined).toHaveLength(2);
    });

    it('should merge if alwaysMerge is set, even if next word is a starter', () => {
        const sentences: SentenceNode[] = [
            { text: 'Prof.', cfi: 'epubcfi(/6/2!/4/1,:0,:5)' },
            { text: 'He is smart.', cfi: 'epubcfi(/6/2!/4/1,:5,:17)' }
        ];

        // "He" is a sentence starter.
        const abbreviations = ['Prof.'];
        const alwaysMerge = ['Prof.'];
        const sentenceStarters = ['He'];

        const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, sentenceStarters);

        expect(refined).toHaveLength(1);
        expect(refined[0].text).toBe('Prof. He is smart.');
        expect(refined[0].cfi).toBe('epubcfi(/6/2!/4/1,:0,:17)');
    });

    it('should NOT merge if next word is a starter and NOT alwaysMerge', () => {
        const sentences: SentenceNode[] = [
            { text: 'Dr.', cfi: 'epubcfi(/6/2!/4/1,:0,:3)' },
            { text: 'He is smart.', cfi: 'epubcfi(/6/2!/4/1,:3,:15)' }
        ];

        const abbreviations = ['Dr.'];
        const alwaysMerge: string[] = [];
        const sentenceStarters = ['He'];

        const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, sentenceStarters);

        expect(refined).toHaveLength(2);
    });

    it('should handle merging across different elements (complex CFI)', () => {
        // This is a harder case where parents might be different or path is different.
        // refineSegments falls back to generateCfiRange(last.cfi, current.cfi)
        // Let's assume they share some common root.

        // Sent A: /6/2!/4/1:10 to /6/2!/4/1:20
        // Sent B: /6/2!/4/2:0 to /6/2!/4/2:10 (Next paragraph)
        const sentences: SentenceNode[] = [
             { text: 'Part 1.', cfi: 'epubcfi(/6/2!/4/1,:10,:20)' },
             { text: 'Part 2.', cfi: 'epubcfi(/6/2!/4/2,:0,:10)' }
        ];

        // Force merge
        const abbreviations = ['Part 1.']; // Weird abbr but ok for test
        const alwaysMerge = ['Part 1.'];

        const refined = TextSegmenter.refineSegments(sentences, abbreviations, alwaysMerge, []);

        expect(refined).toHaveLength(1);
        expect(refined[0].text).toBe('Part 1. Part 2.');

        // start: /6/2!/4/1:10
        // end: /6/2!/4/2:10
        // common: /6/2!/4 (split at slash)
        // startRel: /1:10
        // endRel: /2:10
        // Expected: epubcfi(/6/2!/4,/1:10,/2:10)
        expect(refined[0].cfi).toBe('epubcfi(/6/2!/4,/1:10,/2:10)');
    });
});
