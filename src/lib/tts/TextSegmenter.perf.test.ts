import { describe, it, expect, vi } from 'vitest';
import { TextSegmenter } from './TextSegmenter';
import type { SentenceNode } from '../tts';

describe('TextSegmenter Performance', () => {
    it('avoids unnecessary string splitting during post-processing', () => {
        // Create a segmenter with a dummy abbreviation to potentially trigger logic
        // Note: Constructor only takes locale, extra args are ignored but kept here to match previous test style
        // @ts-expect-error: extra args are ignored but kept here to match previous test style
        const segmenter = new TextSegmenter('en', ['Dr.']);

        // precise number of sentences
        const numSentences = 100;
        const sentence = "This is a moderately long sentence to demonstrate the performance impact of splitting strings.";
        const text = Array(numSentences).fill(sentence).join(" ");

        const splitSpy = vi.spyOn(String.prototype, 'split');

        segmenter.segment(text);

        const callCount = splitSpy.mock.calls.length;
        console.log(`Split called ${callCount} times for ${numSentences} sentences.`);

        splitSpy.mockRestore();

        // REGRESSION TEST:
        // Previously, the implementation used `split` roughly once per sentence boundary.
        // This test ensures we rely on efficient regex extraction instead.
        // We assert that split calls are minimal (effectively 0 for this logic).
        expect(callCount).toBeLessThan(10);
    });

    it('avoids unnecessary string trimming during refinement', () => {
        const sentences: SentenceNode[] = [];
        const count = 1000;

        for (let i = 0; i < count; i++) {
            if (i % 5 === 0) sentences.push({ text: "Hello Mr.", cfi: `cfi_${i}` });
            else if (i % 5 === 1) sentences.push({ text: "smith went.", cfi: `cfi_${i}` });
            else sentences.push({ text: "Normal sentence.", cfi: `cfi_${i}` });
        }

        const abbreviations = ['Mr.'];
        const alwaysMerge: string[] = []; // empty to allow checking next word
        const sentenceStarters = ['The'];

        const trimSpy = vi.spyOn(String.prototype, 'trim');

        TextSegmenter.refineSegments(
            sentences,
            abbreviations,
            alwaysMerge,
            sentenceStarters
        );

        const callCount = trimSpy.mock.calls.length;
        console.log(`Trim called ${callCount} times.`);

        trimSpy.mockRestore();
        expect(callCount).toBe(0);
    });
});
