
import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { SentenceNode } from '../tts';

describe('AudioContentPipeline Table CFI Logic', () => {
    const pipeline = new AudioContentPipeline();

    it('should correctly exclude siblings when using Range CFI with parent container', () => {
        // Table CFI is a range within parent /6/14!/4
        // Range covers child 2 to 3.
        const tableCfi = 'epubcfi(/6/14!/4,/2,/3)';
        const adaptationText = 'Table content';

        const adaptationsMap = new Map<string, string>();
        adaptationsMap.set(tableCfi, adaptationText);

        const sentences: SentenceNode[] = [
            { text: 'Inside Table', cfi: 'epubcfi(/6/14!/4/2/1:0)' },
            { text: 'Outside Sibling', cfi: 'epubcfi(/6/14!/4/4/1:0)' }
        ];

        const result = pipeline.mapSentencesToAdaptations(sentences, adaptationsMap);

        const indices = result.flatMap(r => r.indices);
        expect(indices).toContain(0); // Inside
        expect(indices).not.toContain(1); // Outside
        expect(indices.length).toBe(1);
    });
});
