
import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';

// Helper to access private method
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupSentences(pipeline: AudioContentPipeline, sentences: any[]): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pipeline as any).groupSentencesByRoot(sentences);
}

describe('AudioContentPipeline Grouping Logic', () => {
    it('should consistently group elements sharing a common block ancestor regardless of order', () => {
        const pipeline = new AudioContentPipeline();

        // Data setup using correct CFIs with spine separator (!)
        // Spine: /6/14

        // Div text node: path /4/1:0 -> Parent /4
        const divText = { text: 'Div Text', cfi: 'epubcfi(/6/14!/4/1:0)' };

        // P1 text node: path /4/2/1:0 -> Parent /4/2
        const p1Text = { text: 'P1 Text', cfi: 'epubcfi(/6/14!/4/2/1:0)' };

        // P2 text node: path /4/4/1:0 -> Parent /4/4
        const p2Text = { text: 'P2 Text', cfi: 'epubcfi(/6/14!/4/4/1:0)' };

        // Case 1: Div, P1, P2
        const case1 = groupSentences(pipeline, [divText, p1Text, p2Text]);

        // Case 2: P1, Div, P2
        const case2 = groupSentences(pipeline, [p1Text, divText, p2Text]);

        // Case 3: P1, P2, Div
        const case3 = groupSentences(pipeline, [p1Text, p2Text, divText]);

        // Case 4: P1, P2 (No Div)
        const case4 = groupSentences(pipeline, [p1Text, p2Text]);

        // All should be consistently grouped under the common ancestor block (/4)
        expect(case1.length).toBe(1);
        expect(case2.length).toBe(1);
        expect(case3.length).toBe(1);
        expect(case4.length).toBe(1);
    });
});
