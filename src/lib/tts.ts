import { TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from './tts/TextSegmenter';
import { Sanitizer } from './tts/processors/Sanitizer';
import { createLogger } from './logger';

const logger = createLogger('TTS-Utils');

/**
 * Represents a sentence and its corresponding location (CFI) in the book.
 */
export interface SentenceNode {
    /** The text content of the sentence. */
    text: string;
    /** The Canonical Fragment Identifier (CFI) pointing to the sentence's location. */
    cfi: string;
    /** The indices of the raw source sentences that make up this node. */
    sourceIndices?: number[];
}

export interface ExtractionOptions {
    abbreviations?: string[];
    alwaysMerge?: string[];
    sentenceStarters?: string[];
    sanitizationEnabled?: boolean;
}

const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
    'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION',
    'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD',
    'NAV', 'ADDRESS', 'HR'
]);

/**
 * Extracts sentences from a DOM Node (e.g., document body).
 *
 * @param rootNode - The root DOM node to traverse.
 * @param cfiGenerator - A callback function that generates a CFI string from a DOM Range.
 * @param options - Configuration options for segmentation.
 * @returns An array of SentenceNode objects.
 */
export const extractSentencesFromNode = (
    rootNode: Node,
    cfiGenerator: (range: Range) => string | null,
    options: ExtractionOptions = {}
): SentenceNode[] => {
    // Collect raw sentences first
    const rawSentences: SentenceNode[] = [];
    const doc = rootNode.ownerDocument || (rootNode as Document);

    // Default sanitization to true if not specified
    const sanitizationEnabled = options.sanitizationEnabled !== undefined ? options.sanitizationEnabled : true;

    // Initialize segmenter
    const segmenter = new TextSegmenter('en');

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
            if (parent.closest) {
                isPre = !!parent.closest('pre, PRE');
            } else {
                // Fallback if closest is missing
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

        const textForSegmentation = isPre ? textBuffer : textBuffer.replace(/[\n\r]/g, ' ');
        const segments = segmenter.segment(textForSegmentation);

        for (const segment of segments) {
            let processedText = segment.text;

            if (sanitizationEnabled) {
                processedText = Sanitizer.sanitize(processedText);
            }

            if (!processedText.trim()) continue;

            const start = segment.index;
            const end = segment.index + segment.length;

            const range = doc.createRange();
            let currentBase = 0;
            let startSet = false;
            let endSet = false;

            for (const { node, length } of textNodes) {
                if (!startSet && currentBase + length > start) {
                    const offset = Math.max(0, start - currentBase);
                    range.setStart(node, offset);
                    startSet = true;
                }

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
                    const cfi = cfiGenerator(range);
                    if (cfi) {
                        rawSentences.push({
                            text: processedText.trim(),
                            cfi: cfi
                        });
                    }
                } catch (e) {
                    logger.warn("Failed to generate CFI for range", e);
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

            // Citation Heuristics: Skip <sup> or <a> containing only typical citation markers
            // We do this before checking for block tags or traversing children
            if (tagName === 'SUP' || tagName === 'A') {
                const text = el.textContent?.trim() || '';
                // Three patterns that identify typical citation marker text:
                //   /^\[?\d+\]?$/  — bare or bracketed number: "1", "12", "[1]", "[12]"
                //   /^\(\d+\)$/    — parenthesized number:     "(1)", "(12)"
                //   /^[*†‡]+$/    — symbol markers:           "*", "†", "‡", "**"
                const isCitationText = /^\[?\d+\]?$/.test(text) || /^\(\d+\)$/.test(text) || /^[*†‡]+$/.test(text);

                if (isCitationText) {
                    if (tagName === 'SUP') {
                        return; // Always skip superscript citations
                    } else if (tagName === 'A') {
                        const href = el.getAttribute('href') || '';
                        const hasEpubType = el.getAttribute('epub:type') === 'noteref';
                        const hasRole = el.getAttribute('role') === 'doc-noteref';

                        // Skip if: epub:type=noteref, role=doc-noteref, local anchor #,
                        // or links to an external notes/endnotes file
                        const isNoteLink = href.startsWith('#')
                            || /notes/i.test(href)
                            || /endnote/i.test(href)
                            || /footnote/i.test(href);

                        if (hasEpubType || hasRole || isNoteLink) {
                            return;
                        }
                    }
                }
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

    traverse(rootNode);
    flushBuffer();

    // Assign source indices to raw sentences
    rawSentences.forEach((s, i) => {
        s.sourceIndices = [i];
    });

    // Now refine segments using the options provided
    return TextSegmenter.refineSegments(
        rawSentences,
        options.abbreviations || [],
        options.alwaysMerge || DEFAULT_ALWAYS_MERGE,
        options.sentenceStarters || DEFAULT_SENTENCE_STARTERS
    );
};
