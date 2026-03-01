import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './src/lib/tts/AudioContentPipeline';
import { preprocessBlockRoots } from './src/lib/cfi-utils';

describe('groupSentencesByRoot behavior', () => {
    it('groups correctly', () => {
        const pipeline = new AudioContentPipeline();

        const tableImages = [
            { cfi: 'epubcfi(/6/28!/4/2/14)' } // Emulate what DB has
        ];

        const sentences = [
            { text: 'A', cfi: 'epubcfi(/6/28!/4/2/14/1:1)' },
            { text: 'B', cfi: 'epubcfi(/6/28!/4/2/14/1:2)' },
            { text: 'C', cfi: 'epubcfi(/6/28!/4/2/14/2/2/80/4/2/1:7)' }
        ];

        // @ts-ignore
        const preprocessedTableRoots = pipeline.preprocessTableRoots(tableImages);

        // @ts-ignore
        const groups = pipeline.groupSentencesByRoot(sentences, preprocessedTableRoots);
        console.log("GROUPS:", JSON.stringify(groups, null, 2));
        expect(groups).toBeDefined();
    });
});
