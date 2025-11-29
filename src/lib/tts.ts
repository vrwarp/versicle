import type { Rendition } from 'epubjs';
import { TextSegmenter } from './tts/TextSegmenter';
import { useTTSStore } from '../store/useTTSStore';

/**
 * Represents a sentence and its corresponding location (CFI) in the book.
 */
export interface SentenceNode {
    /** The text content of the sentence. */
    text: string;
    /** The Canonical Fragment Identifier (CFI) pointing to the sentence's location. */
    cfi: string;
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
  'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION',
  'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD',
  'NAV', 'ADDRESS', 'HR'
]);

/**
 * Extracts sentences from the current rendition's chapter.
 * Uses TextSegmenter (Intl.Segmenter) for robust sentence splitting.
 *
 * @param rendition - The current epubjs Rendition object.
 * @returns An array of SentenceNode objects representing the sentences in the current view.
 */
export const extractSentences = (rendition: Rendition): SentenceNode[] => {
    const sentences: SentenceNode[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = (rendition as any).getContents()[0];

    if (!contents) return [];

    const doc = contents.document;
    const body = doc.body;

    // Initialize segmenter
    const { customAbbreviations, alwaysMerge, sentenceStarters } = useTTSStore.getState();
    const segmenter = new TextSegmenter('en', customAbbreviations, alwaysMerge, sentenceStarters);

    let textBuffer = '';
    let textNodes: { node: Node, length: number }[] = [];

    const flushBuffer = () => {
        if (!textBuffer.trim()) {
            textBuffer = '';
            textNodes = [];
            return;
        }

        const segments = segmenter.segment(textBuffer);

        for (const segment of segments) {
            // Only process non-empty segments
            if (!segment.text.trim()) continue;

            const start = segment.index;
            const end = segment.index + segment.length;

            const range = doc.createRange();
            let currentBase = 0;
            let startSet = false;
            let endSet = false;

            for (const { node, length } of textNodes) {
                // Check if start is in this node
                if (!startSet && currentBase + length > start) {
                     // Ensure offset is non-negative
                     const offset = Math.max(0, start - currentBase);
                     range.setStart(node, offset);
                     startSet = true;
                }

                // Check if end is in this node
                if (!endSet && currentBase + length >= end) {
                    const offset = Math.max(0, end - currentBase);
                    range.setEnd(node, offset);
                    endSet = true;
                }

                currentBase += length;
                if (startSet && endSet) break;
            }

            if (startSet && endSet) {
                 try {
                    const cfi = contents.cfiFromRange(range);
                    sentences.push({
                        text: segment.text.trim(),
                        cfi: cfi
                    });
                } catch (e) {
                    console.warn("Failed to generate CFI for range", e);
                }
            }
        }

        textBuffer = '';
        textNodes = [];
    };

    const traverse = (node: Node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tagName = el.tagName.toUpperCase();

            // Skip ignored tags
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT'].includes(tagName)) {
                return;
            }

            const isBlock = BLOCK_TAGS.has(tagName);
            const isBreak = tagName === 'BR';

            if (isBlock) flushBuffer();

            if (isBreak) {
                flushBuffer();
            } else {
                node.childNodes.forEach(child => traverse(child));
            }

            if (isBlock) flushBuffer();

        } else if (node.nodeType === Node.TEXT_NODE) {
            const val = node.textContent || '';
            if (val.length > 0) {
                textBuffer += val;
                textNodes.push({ node, length: val.length });
            }
        }
    };

    traverse(body);
    flushBuffer();

    return sentences;
};
