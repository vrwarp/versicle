import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './src/lib/tts/AudioContentPipeline';

describe('AudioContentPipeline mapping with Point CFIs', () => {
    it('matches sentences using Point CFI prefix', () => {
        const pipeline = new AudioContentPipeline();

        // The adaptationsMap contains a Point CFI (legacy converted or freshly ingested)
        const adaptationsMap = new Map<string, string>();
        adaptationsMap.set('epubcfi(/6/28!/4/2/14)', 'ADAPTATION_TEXT');

        // simulate sentences
        const sentences = [
            { text: 'A', cfi: 'epubcfi(/6/28!/4/2/14/1:1)' },
            { text: 'B', cfi: 'epubcfi(/6/28!/4/2/14/1:2)' },
            { text: 'C', cfi: 'epubcfi(/6/28!/4/2/14/2/2/80/4/2/1:7)' },
            { text: 'D', cfi: 'epubcfi(/6/28!/4/2/16/1:0)' } // Should NOT match (sibling)
        ];

        const result = pipeline.mapSentencesToAdaptations(sentences, adaptationsMap);

        expect(result.length).toBe(1);
        expect(result[0].text).toBe('ADAPTATION_TEXT');
        expect(result[0].indices).toEqual([0, 1, 2]); // A, B, C matched. D ignored.
    });

    it('does not match false positive sibling point CFIs', () => {
        const pipeline = new AudioContentPipeline();

        const adaptationsMap = new Map<string, string>();
        adaptationsMap.set('epubcfi(/6/28!/4/2/14)', 'ADAPTATION_TEXT');

        const sentences = [
            { text: 'False Positive', cfi: 'epubcfi(/6/28!/4/2/142/1:1)' } // 142 instead of 14
        ];

        const result = pipeline.mapSentencesToAdaptations(sentences, adaptationsMap);

        expect(result.length).toBe(0);
    });
});
