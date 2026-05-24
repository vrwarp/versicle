import { describe, it, expect } from 'vitest';
import { AudioContentPipeline } from './AudioContentPipeline';
import { extractSentencesFromNode } from '../tts';
import { EpubCFI } from 'epubjs';

const createMockCfiGenerator = () => (range: Range): string => {
    const epubCfi = new EpubCFI(range, '/6/14!');
    return epubCfi.toString();
};

describe('AudioContentPipeline - Structural Anomaly Grouping (TDD Regression)', () => {
    const pipeline = new AudioContentPipeline();

    it('should correctly segment body paragraphs into separate groups even when anomalous metadata tags are present in the body', () => {
        // Construct the anomalous HTML DOM where metadata tags are placed inside the body
        const container = document.createElement('div');
        document.body.appendChild(container);
        container.innerHTML = `
            <p class="intro-quote">"This is the first random quote."</p>
            <p class="intro-author">First Author</p>
            <p class="intro-quote">"This is the second random quote."</p>
            <p class="intro-author">Second Author</p>
            <p class="intro-quote">"This is the third random quote."</p>
            <p class="intro-author">Third Author</p>
            
            <base href="https://localhost:5173/content/chapter-1.xhtml">
            <meta http-equiv="content-type" content="text/html; charset=UTF-8">
            <title>Chapter 1: The Mystery of the Grouping</title>
            <link href="blob:https://localhost:5173/stylesheet.css" rel="stylesheet" type="text/css">
            
            <div class="section">
                <p class="chapter-number">Chapter 1</p>
                <p class="chapter-title">The Mystery of the Grouping</p>
                <p class="body-text">This is the first paragraph of the actual body text of the chapter.</p>
                <p class="body-text">This is the second paragraph of the body text.</p>
            </div>
        `;

        const cfiGen = createMockCfiGenerator();
        
        // Extract sentences from the DOM
        const sentences = extractSentencesFromNode(container, cfiGen);
        document.body.removeChild(container);

        // Call the private groupSentencesByRoot method
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const groups = (pipeline as any).groupSentencesByRoot(sentences);

        // TDD EXPECTATION:
        // Under correct behavior, all body paragraphs are correctly isolated:
        // - 6 groups for intro elements
        // - 1 group for the chapter number ("Chapter 1")
        // - 1 group for the chapter title ("The Mystery of the Grouping")
        // - 2 groups for the body paragraphs
        // Total expected groups: 10
        //
        // NOTE: This will FAIL (returning a length of 6) under the current bug
        // because the root Range CFI for the title tag causes all subsequent paragraphs to collapse.
        // It will PASS once the structural metadata tags are added to skipped tags in tts.ts.
        expect(groups).toHaveLength(10);

        // Verify body paragraphs are in their own separate groups
        const bodyGroup1 = groups[8];
        const bodyGroup2 = groups[9];
        
        expect(bodyGroup1.segments[0].text).toContain('This is the first paragraph of the actual body text');
        expect(bodyGroup2.segments[0].text).toContain('This is the second paragraph of the body text');
    });
});
