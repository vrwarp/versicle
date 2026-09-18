/**
 * Sentence extraction — the INGESTION-side half of TTS content preparation
 * (Phase 5c; phase5-tts-strangler.md §5c.1, relocated from src/lib/tts/).
 * The final `src/domains/library/ingestion/` address arrives with the Phase 7
 * rewrite; this is the one move (README "nothing moves twice").
 */
import { TextSegmenter } from '../tts/TextSegmenter';
import { Sanitizer } from '../tts/processors/Sanitizer';
import { createLogger } from '../logger';
import type { SentenceNode, ExtractionResult, CitationMarker } from '~types/tts-content';

const logger = createLogger('TTS-Utils');

// Consumption types live in the types layer since 5c-PR4 (the engine →
// extractor reverse type-import died); re-exported for ingestion-side callers.
export type { SentenceNode, ExtractionResult,  };

/**
 * Version of the sentence-extraction algorithm, stamped onto newly written
 * `cache_tts_preparation` rows (`CacheTtsPreparation.extractionVersion`).
 *
 * v3 ("raw at rest", 5c-PR4): rows store UNREFINED sentences — the ingest-time
 * refineSegments pass (which baked the import-time abbreviation/starter
 * settings into persisted rows) is gone. Playback always refines against the
 * CURRENT settings (SectionQueueBuilder), so v1/v2 rows keep working — they
 * were simply refined once more than necessary. Old rows are RETAINED (the
 * graft rule); the background re-ingestion driver is Phase 7 scope.
 *
 * v2: segmentation offsets are computed against the RAW text (NFKD applies only
 * to the outbound sentence text), so Range/CFI positions are correct for
 * non-ASCII books. Rows without a version (implicit v1) were segmented against
 * NFKD-normalized text and may carry drifted CFIs wherever decomposable
 * characters (é, ﬁ, …) precede a sentence start.
 */
export const TTS_EXTRACTION_VERSION = 3;

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
 * Every character that can survive `trim()` in a string CITATION_TEXT_RE can
 * match: digits and bracket/paren glyphs (alternative 1), the symbol markers
 * (alternative 2), and whitespace (trimmed away at the ends, fatal anywhere
 * else).
 */
const CITATION_ALLOWED_TEXT_RE = /^[\s\d()[\]*†‡§¶]*$/;

/**
 * `el.textContent`, or null as soon as a character appears that
 * CITATION_TEXT_RE could never match — such a character is not whitespace, so
 * it survives the trim and the regex is guaranteed to fail. Detection runs on
 * every <sup>/<sub>/<a>/<span> of every chapter, and a <span> wrapping a
 * whole paragraph used to be flattened into a string just to fail that test.
 */
function citationCandidateText(el: Element): string | null {
    let text = '';
    const visit = (node: Node): boolean => {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
            const data = node.textContent || '';
            if (!CITATION_ALLOWED_TEXT_RE.test(data)) return false;
            text += data;
            return true;
        }
        for (const child of node.childNodes) {
            if (!visit(child)) return false;
        }
        return true;
    };
    return visit(el) ? text : null;
}

/**
 * Classifies an inline element as a citation marker and captures its metadata.
 * Handles <sup>, <sub>, <a> with note-link semantics, and CSS-superscript <span>.
 */
function detectCitationMarkerElement(el: Element, cfiGenerator: (range: Range) => string | null, doc: Document): CitationDetection {
    const tagName = el.tagName.toUpperCase();
    const candidate = citationCandidateText(el);
    if (candidate === null) return NO_CITATION;
    const text = candidate.trim();

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
    /** Sanitize extracted text (default true). */
    sanitizationEnabled?: boolean;
    /** Segmentation locale (book language). */
    locale?: string;
}

const BLOCK_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
    'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION',
    'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD',
    'NAV', 'ADDRESS', 'HR'
]);

/** Tags whose subtrees never contribute spoken text. */
const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME',
    'OBJECT', 'TITLE', 'META', 'LINK', 'BASE', 'HEAD',
]);

/** Cooperative-yield seam for {@link extractSentencesFromNodeAsync}. */
export interface ExtractionYieldControl {
    /**
     * Consulted at every flush point (block boundary). True hands the main
     * thread back before the next block is segmented.
     */
    shouldYield(): boolean;
    /** How to yield; defaults to a macrotask hop. */
    yieldFn?(): Promise<void>;
}

/**
 * One extraction run, shared verbatim by the sync and async entry points.
 *
 * `walk` is a generator that yields at every flush point — the only places
 * where pausing is safe and useful, since a flush is where a block's buffered
 * text is segmented, sanitized and turned into ranges + CFIs. The synchronous
 * driver simply runs it to completion; the async one may await between
 * yields. Output is identical either way: yielding changes no state.
 */
function createExtractionRun(
    rootNode: Node,
    cfiGenerator: (range: Range) => string | null,
    options: ExtractionOptions,
): { walk: () => Generator<void, void, void>; finish: () => ExtractionResult } {
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

        // Segments arrive in order, so the node cursor only ever moves
        // FORWARD: the node holding the previous segment's start is the
        // earliest one this segment's start can be in. (The old loop restarted
        // from node 0 for every segment — O(segments × nodes) per block, which
        // is quadratic in a long paragraph of many inline runs.)
        let startIndex = 0;
        let startBase = 0;

        for (const segment of segments) {
            let processedText = segment.text;

            if (sanitizationEnabled) {
                processedText = Sanitizer.sanitize(processedText);
            }

            if (!processedText.trim()) continue;

            const start = segment.index;
            const end = segment.index + segment.length;

            while (
                startIndex < textNodes.length &&
                startBase + textNodes[startIndex].length <= start
            ) {
                startBase += textNodes[startIndex].length;
                startIndex += 1;
            }
            // Past the end of the buffered nodes: the old loop left startSet
            // false and dropped the sentence.
            if (startIndex >= textNodes.length) continue;

            let endIndex = startIndex;
            let endBase = startBase;
            while (endIndex < textNodes.length && endBase + textNodes[endIndex].length < end) {
                endBase += textNodes[endIndex].length;
                endIndex += 1;
            }
            if (endIndex >= textNodes.length) continue; // endSet false

            const range = doc.createRange();
            range.setStart(textNodes[startIndex].node, Math.max(0, start - startBase));
            range.setEnd(textNodes[endIndex].node, Math.max(0, end - endBase));

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

        textBuffer = '';
        textNodes = [];
    };

    function* traverse(node: Node): Generator<void, void, void> {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tagName = el.tagName.toUpperCase();

            // Skip ignored tags
            if (IGNORED_TAGS.has(tagName)) {
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

            if (isBlock) {
                flushBuffer();
                yield;
            }

            if (isBreak) {
                flushBuffer();
                yield;
            } else {
                for (const child of node.childNodes) yield* traverse(child);
            }

            if (isBlock) {
                flushBuffer();
                yield;
            }

        } else if (node.nodeType === Node.TEXT_NODE) {
            const val = node.textContent || '';
            if (val.length > 0) {
                textBuffer += val;
                textNodes.push({ node, length: val.length });
            }
        }
    }

    return {
        walk: () => traverse(rootNode),
        finish: () => {
            flushBuffer();

            // Assign source indices to raw sentences
            rawSentences.forEach((s, i) => {
                s.sourceIndices = [i];
            });

            // RAW AT REST (extraction v3): no ingest-time refinement — persisted
            // rows carry the raw segmentation; playback refines against current
            // settings.
            return { sentences: rawSentences, citationMarkers };
        },
    };
}

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
    const run = createExtractionRun(rootNode, cfiGenerator, options);
    for (const _ of run.walk()) { /* run to completion, never yielding */ }
    return run.finish();
};

/**
 * The same extraction, able to hand the main thread back INSIDE a chapter.
 *
 * The synchronous pass is one unbroken traversal of a whole chapter — DOM
 * walk, Intl.Segmenter, sanitization, createRange and a CFI per sentence —
 * and the offscreen renderer could only yield BETWEEN chapters, so a
 * single-XHTML book blocked the main thread for the entire book. `control`
 * is consulted at each block boundary; the output is byte-identical to
 * {@link extractSentencesFromNode} (the C8 fixtures pin it).
 */
export const extractSentencesFromNodeAsync = async (
    rootNode: Node,
    cfiGenerator: (range: Range) => string | null,
    options: ExtractionOptions = {},
    control?: ExtractionYieldControl,
): Promise<ExtractionResult> => {
    const run = createExtractionRun(rootNode, cfiGenerator, options);
    const yieldToHost = control?.yieldFn ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
    for (const _ of run.walk()) {
        if (control?.shouldYield()) await yieldToHost();
    }
    return run.finish();
};
