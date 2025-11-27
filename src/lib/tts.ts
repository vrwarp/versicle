import ePub, { Rendition } from 'epubjs';

export interface SentenceNode {
    text: string;
    cfi: string;
}

/**
 * Extracts sentences from the current rendition's chapter.
 * This is a simplified implementation that extracts text nodes and splits by punctuation.
 * For a production app, a more robust NLP sentence splitter would be better,
 * but this serves the purpose of mapping text to CFIs.
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

    // Simple regex for sentence splitting (., !, ?)
    // Note: This is naive. "Mr. Smith" will split.
    const sentenceRegex = /([^\.!\?]+[\.!\?]+)/g;

    while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (!text) continue;

        // If the text node is just whitespace, skip
        if (text.length === 0) continue;

        // Split text into sentences
        // We need to keep track of offset within the node to create accurate ranges
        let match;
        const textContent = node.textContent || '';

        // Reset regex index
        sentenceRegex.lastIndex = 0;

        let lastIndex = 0;

        // Find matches
        while ((match = sentenceRegex.exec(textContent)) !== null) {
            const sentenceText = match[0];
            const startIndex = match.index;
            const endIndex = match.index + sentenceText.length;

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

            lastIndex = endIndex;
        }

        // Handle remaining text if any (e.g. no punctuation at end of node)
        // This often happens if a sentence spans multiple nodes, but for simplicity
        // we treat text nodes as boundaries in this MVP version or assume simplified structure.
        if (lastIndex < textContent.length) {
             const remainingText = textContent.substring(lastIndex);
             if (remainingText.trim().length > 0) {
                 const range = doc.createRange();
                 range.setStart(node, lastIndex);
                 range.setEnd(node, textContent.length);

                  try {
                    // @ts-expect-error epubjs types might be incomplete
                    const cfi = contents.cfiFromRange(range);
                    sentences.push({
                        text: remainingText.trim(),
                        cfi: cfi
                    });
                } catch (e) {
                     console.warn("Failed to generate CFI for remaining range", e);
                }
             }
        }
    }

    return sentences;
};
