import type { Rendition } from 'epubjs';
import { TextSegmenter } from './tts/TextSegmenter';
import { useTTSStore } from '../store/useTTSStore';
import { Sanitizer } from './tts/processors/Sanitizer';

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
    const { customAbbreviations, alwaysMerge, sentenceStarters, sanitizationEnabled } = useTTSStore.getState();
    const segmenter = new TextSegmenter('en', customAbbreviations, alwaysMerge, sentenceStarters);

    let textBuffer = '';
    let textNodes: { node: Node, length: number }[] = [];

    const flushBuffer = () => {
        if (!textBuffer.trim()) {
            textBuffer = '';
            textNodes = [];
            return;
        }

        // Check if we are inside a PRE tag (or nested within one)
        const firstNode = textNodes.length > 0 ? textNodes[0].node : null;
        let isPre = false;
        if (firstNode && firstNode.parentElement) {
            // Use closest if available (standard in browsers) or traverse up
            const parent = firstNode.parentElement;
            // Check for 'pre' (HTML/XHTML) or 'PRE' (canonical uppercase)
            // Using closest is robust for nested elements like <pre><code>...</code></pre>
            if (parent.closest) {
                isPre = !!parent.closest('pre, PRE');
            } else {
                 // Fallback if closest is missing (unlikely in modern envs but safe)
                 let current: Element | null = parent;
                 while (current) {
                     if (current.tagName.toUpperCase() === 'PRE') {
                         isPre = true;
                         break;
                     }
                     current = current.parentElement;
                 }
            }
        }

        // Replace newlines with spaces to avoid splitting sentences on newlines within block tags,
        // unless we are in a PRE tag where formatting should be preserved.
        // This preserves the string length so that indices mapping to textNodes remains valid.
        // We also handle carriage returns for safety.
        const textForSegmentation = isPre ? textBuffer : textBuffer.replace(/[\n\r]/g, ' ');

        const segments = segmenter.segment(textForSegmentation);

        for (const segment of segments) {
            let processedText = segment.text;

            if (sanitizationEnabled) {
                processedText = Sanitizer.sanitize(processedText);
            }

            // Only process non-empty segments
            if (!processedText.trim()) continue;

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
                        text: processedText.trim(),
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
