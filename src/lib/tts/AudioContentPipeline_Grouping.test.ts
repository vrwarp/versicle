
import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';

// Helper to access private method
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupSentences(pipeline: AudioContentPipeline, sentences: any[]): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (pipeline as any).groupSentencesByRoot(sentences);
}

describe('AudioContentPipeline Grouping Logic', () => {
    it('should inconsistently split groups depending on order (P1, Div, P2 vs Div, P1, P2)', () => {
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
        // Expected: All grouped together because Div is ancestor of both
        const case1 = groupSentences(pipeline, [divText, p1Text, p2Text]);

        // Case 2: P1, Div, P2
        // Expected: All grouped together because P1 initiates group, Div expands scope to /4, then P2 fits in /4
        const case2 = groupSentences(pipeline, [p1Text, divText, p2Text]);

        console.log('Case 1 Groups:', case1.length);
        console.log('Case 2 Groups:', case2.length);

        expect(case1.length).toBe(1); // Div captures both children
        expect(case2.length).toBe(1); // Div (in middle) expands scope to capture P2
    });
});
