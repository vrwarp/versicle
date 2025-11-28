import ePub, { Rendition } from 'epubjs';
import { TextSegmenter } from './tts/TextSegmenter';

/**
 * Represents a sentence and its corresponding location (CFI) in the book.
 */
export interface SentenceNode {
    /** The text content of the sentence. */
    text: string;
    /** The Canonical Fragment Identifier (CFI) pointing to the sentence's location. */
    cfi: string;
}

/**
 * Extracts sentences from the current rendition's chapter.
 * Uses TextSegmenter (Intl.Segmenter) for robust sentence splitting.
 *
 * @param rendition - The current epubjs Rendition object.
 * @returns An array of SentenceNode objects representing the sentences in the current view.
 */
export const extractSentences = (rendition: Rendition): SentenceNode[] => {
    const sentences: SentenceNode[] = [];
    const contents = rendition.getContents()[0];

    if (!contents) return [];

    const doc = contents.document;
    const body = doc.body;

    // Create a TreeWalker to find all text nodes
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;

    // Initialize segmenter
    const segmenter = new TextSegmenter();

    while ((node = walker.nextNode())) {
        const textContent = node.textContent || '';

        // Skip empty or whitespace-only nodes
        if (!textContent.trim()) continue;

        const segments = segmenter.segment(textContent);

        for (const segment of segments) {
            const startIndex = segment.index;
            const endIndex = segment.index + segment.length;
            const sentenceText = segment.text;

            // Only process non-empty segments
            if (!sentenceText.trim()) continue;

            // Create range for this sentence
            const range = doc.createRange();
            range.setStart(node, startIndex);
            range.setEnd(node, endIndex);

            // Generate CFI
            try {
                // @ts-expect-error epubjs types might be incomplete
                const cfi = contents.cfiFromRange(range);

                sentences.push({
                    text: sentenceText.trim(),
                    cfi: cfi
                });
            } catch (e) {
                console.warn("Failed to generate CFI for range", e);
            }
        }
    }

    return sentences;
};
