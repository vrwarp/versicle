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
 * This is a simplified implementation that extracts text nodes and splits by punctuation.
 * For a production app, a more robust NLP sentence splitter would be better,
 * but this serves the purpose of mapping text to CFIs.
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

    // We need the base CFI for the current chapter/spine item to construct CFIs for ranges
    // However, epub.js CFI generation often requires the 'epubcfi' object or rendition.
    // rendition.currentLocation().start.cfi gives the global CFI.
    // But for generating CFIs for specific nodes, we usually use contents.cfiFromNode(node) or cfiFromRange(range).

    // Create a TreeWalker to find all text nodes
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;

    // Use the robust TextSegmenter (Intl.Segmenter based)
    const segmenter = TextSegmenter.getInstance();

    while ((node = walker.nextNode())) {
        const textContent = node.textContent || '';
        // If the text node is just whitespace, skip
        if (!textContent.trim()) continue;

        const segments = segmenter.segment(textContent);

        for (const segment of segments) {
             const sentenceText = segment.segment;
             // Skip empty segments
             if (!sentenceText.trim()) continue;

             const startIndex = segment.index;
             const endIndex = startIndex + sentenceText.length;

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
