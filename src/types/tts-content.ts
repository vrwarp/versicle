/**
 * TTS content-preparation types (Phase 5c; phase5-tts-strangler.md §5c.1):
 * the consumption types shared between the ingestion-side sentence extractor
 * (src/lib/ingestion/sentence-extraction.ts) and the TTS engine/pipeline.
 * Living in the types layer (which imports nothing) kills the engine →
 * extractor reverse type-import.
 */

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

/**
 * A captured citation/footnote marker (superscript number, noteref anchor, …)
 * suppressed from the spoken text but kept for reference-section detection.
 */
export interface CitationMarker {
    /** Range CFI of the marker element. */
    cfi: string;
    /** The marker's visible text (e.g. "1", "[2]", "*"). */
    markerText: string;
    /** Element was superscript/subscript (or CSS-super). */
    super: boolean;
    /** Marker text is numeric. */
    numeric: boolean;
    /** Marker immediately follows text without whitespace. */
    glued: boolean;
    /** Marker is the first non-whitespace content of its block (note-head anchors). */
    leading: boolean;
    /** Computed font-size ratio vs parent, when CSS-super detection ran. */
    fontSizeRatio?: number;
    /** href of the marker's anchor (self or nearest child <a>). */
    targetHref?: string;
}

/** The result of extracting one section's prepared TTS content. */
export interface ExtractionResult {
    sentences: SentenceNode[];
    citationMarkers: CitationMarker[];
}
