import { TextSegmenter, DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from './TextSegmenter';
import { Sanitizer } from './processors/Sanitizer';
import { createLogger } from '../logger';
import type { CitationMarker } from '../../types/db';

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

export interface ExtractionResult {
    sentences: SentenceNode[];
    citationMarkers: CitationMarker[];
}

/**
 * Version of the sentence-extraction algorithm, stamped onto newly written
 * `cache_tts_preparation` rows (`CacheTtsPreparation.extractionVersion`).
 *
 * v2: segmentation offsets are computed against the RAW text (NFKD applies only
 * to the outbound sentence text), so Range/CFI positions are correct for
 * non-ASCII books. Rows without a version (implicit v1) were segmented against
 * NFKD-normalized text and may carry drifted CFIs wherever decomposable
 * characters (é, ﬁ, …) precede a sentence start.
 */
export const TTS_EXTRACTION_VERSION = 2;

// Font-size ratio below which an inline element is treated as superscript/subscript.
// Used as a fixed diagnostic threshold — not a tuning target.
const CITATION_FONT_SIZE_RATIO = 0.85;

/** Citation text patterns: bare/bracketed numbers, parenthesized numbers, symbol markers. */
const CITATION_TEXT_RE = /^\[?\(?\d{1,3}\)?\]?$|^[*†‡§¶]+$/;

/**
 * Result of citation detection.
 *  - isCitation: element should be suppressed from spoken text.
 *  - marker: full marker metadata, present only when a CFI could be generated.
 *
 * Suppression is intentionally decoupled from capture: a qualifying <sup>/<a>
 * is always suppressed even if CFI generation fails (matching legacy behavior),
 * but it is only recorded as a marker when its CFI is available.
 */
interface CitationDetection {
    isCitation: boolean;
    marker: CitationMarker | null;
}

const NO_CITATION: CitationDetection = { isCitation: false, marker: null };

/**
 * True when `el` is the first non-whitespace content of its nearest block-level ancestor —
 * i.e., the block "leads with" this marker. Typical of a footnote/endnote entry that opens
 * with its reference anchor, as opposed to an in-text citation that follows running prose.
 */
function isLeadingInBlock(el: Element): boolean {
    let node: Node = el;
    while (node.parentElement) {
        const parent = node.parentElement;
        // Any non-whitespace sibling before us at this level means we don't lead the block.
        let sib = node.previousSibling;
        while (sib) {
            if ((sib.textContent || '').trim() !== '') return false;
            sib = sib.previousSibling;
        }
        if (BLOCK_TAGS.has(parent.tagName.toUpperCase())) return true;
        node = parent;
    }
    return true;
}

/**
 * Classifies an inline element as a citation marker and captures its metadata.
 * Handles <sup>, <sub>, <a> with note-link semantics, and CSS-superscript <span>.
 */
function detectCitationMarkerElement(el: Element, cfiGenerator: (range: Range) => string | null, doc: Document): CitationDetection {
    const tagName = el.tagName.toUpperCase();
    const text = el.textContent?.trim() || '';

    if (!CITATION_TEXT_RE.test(text)) return NO_CITATION;

    // Guard: skip if inside MathML (superscript numbers are exponents there)
    if (el.closest && el.closest('math, [role="math"], .MathJax, .MathJax_Preview')) return NO_CITATION;

    const isNumeric = /^\[?\(?\d{1,3}\)?\]?$/.test(text);

    let isSuper = tagName === 'SUP' || tagName === 'SUB';
    let fontSizeRatio: number | undefined;

    if (!isSuper) {
        if (tagName === 'A') {
            // Anchor is a citation if it has note-link semantics
            const href = el.getAttribute('href') || '';
            const hasEpubType = el.getAttribute('epub:type') === 'noteref';
            const hasRole = el.getAttribute('role') === 'doc-noteref';
            const isNoteLink = href.startsWith('#') || /notes|endnote|footnote/i.test(href);
            if (!hasEpubType && !hasRole && !isNoteLink) return NO_CITATION;
            isSuper = true;
        } else {
            // SPAN or other inline: need computed style to confirm superscript.
            // No defaultView (e.g. DOMParser docs at read-time) → cannot classify → skip.
            const win = doc.defaultView;
            if (!win) return NO_CITATION;
            try {
                const style = win.getComputedStyle(el);
                const va = style.verticalAlign;
                if (va === 'super' || va === 'sub') {
                    isSuper = true;
                } else if (el.parentElement) {
                    const parentStyle = win.getComputedStyle(el.parentElement);
                    const elSize = parseFloat(style.fontSize);
                    const parentSize = parseFloat(parentStyle.fontSize);
                    if (parentSize > 0) {
                        fontSizeRatio = elSize / parentSize;
                        if (fontSizeRatio < CITATION_FONT_SIZE_RATIO) isSuper = true;
                    }
                }
            } catch {
                // ignore
            }
            if (!isSuper) return NO_CITATION;
        }
    }

    // Qualified citation → always suppress. Generate CFI to capture metadata; if
    // CFI generation fails, still suppress but record no marker.
    let cfi: string | null = null;
    try {
        const range = doc.createRange();
        range.selectNode(el);
        cfi = cfiGenerator(range);
    } catch {
        // ignore
    }
    if (!cfi) return { isCitation: true, marker: null };

    // Detect glued: marker immediately follows text without whitespace
    const prevSibling = el.previousSibling;
    const glued = prevSibling?.nodeType === Node.TEXT_NODE &&
        !/\s$/.test(prevSibling.textContent || '');

    // Find target href from self or nearest child <a>
    const anchor = tagName === 'A' ? el : el.querySelector('a');
    const targetHref = anchor?.getAttribute('href') || undefined;

    return {
        isCitation: true,
        marker: {
            cfi,
            markerText: text,
            super: tagName === 'SUP' || tagName === 'SUB' || isSuper,
            numeric: isNumeric,
            glued: !!glued,
            leading: isLeadingInBlock(el),
            fontSizeRatio,
            targetHref,
        },
    };
}

export interface ExtractionOptions {
    abbreviations?: string[];
    alwaysMerge?: string[];
    sentenceStarters?: string[];
    sanitizationEnabled?: boolean;
    locale?: string;
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
 * @returns An ExtractionResult with sentences and captured citation markers.
 */
export const extractSentencesFromNode = (
    rootNode: Node,
    cfiGenerator: (range: Range) => string | null,
    options: ExtractionOptions = {}
): ExtractionResult => {
    // Collect raw sentences first
    const rawSentences: SentenceNode[] = [];
    const citationMarkers: CitationMarker[] = [];
    const doc = rootNode.ownerDocument || (rootNode as Document);

    // Default sanitization to true if not specified
    const sanitizationEnabled = options.sanitizationEnabled !== undefined ? options.sanitizationEnabled : true;

    // Initialize segmenter
    const segmenter = new TextSegmenter(options.locale || 'en');

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
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'TITLE', 'META', 'LINK', 'BASE', 'HEAD'].includes(tagName)) {
                return;
            }

            // Citation detection: capture marker metadata and suppress from spoken text.
            // Handles <sup>, <sub>, <a> with note-link semantics, and CSS-superscript <span>.
            if (tagName === 'SUP' || tagName === 'SUB' || tagName === 'A' || tagName === 'SPAN') {
                const { isCitation, marker } = detectCitationMarkerElement(el, cfiGenerator, doc);
                if (isCitation) {
                    if (marker) citationMarkers.push(marker);
                    return; // suppress from spoken text
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
    const sentences = TextSegmenter.refineSegments(
        rawSentences,
        options.abbreviations || [],
        options.alwaysMerge || DEFAULT_ALWAYS_MERGE,
        options.sentenceStarters || DEFAULT_SENTENCE_STARTERS
    );
    return { sentences, citationMarkers };
};
