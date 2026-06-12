/**
 * Represents the result of a search query within a book.
 * Used by both the SearchEngine (to return results) and the UI (to display them).
 *
 * @example
 * ```ts
 * const result: SearchResult = {
 *   href: "chapter1.html",
 *   excerpt: "...found this text..."
 * };
 * ```
 */
export interface SearchResult {
    /** The reference (href) to the location in the book (e.g., 'chapter1.html'). */
    href: string;
    /** A snippet of text containing the search term, with surrounding context. */
    excerpt: string;
}

/**
 * A per-occurrence search hit (Phase 7 §F, PR-S2). Unlike {@link SearchResult}
 * it carries enough position data to navigate to the EXACT occurrence:
 * `charOffset` into the section's indexed plain text, the per-section
 * `occurrence` ordinal, and an optional `cfi` resolved lazily at click time
 * (the engine/worker never see the DOM).
 */
export interface DetailedSearchResult {
    /** The reference (href) to the section containing the match. */
    href: string;
    /** The section's display title, when the indexed corpus carried one. */
    sectionTitle?: string;
    /** Context snippet sliced from the ORIGINAL text around the match. */
    excerpt: string;
    /** Code-unit offset of the match start within the section's indexed text. */
    charOffset: number;
    /** Code-unit length of the matched text in the original string. */
    matchLength: number;
    /** 1-based ordinal of this match within its section. */
    occurrence: number;
    /**
     * EPUB CFI of the occurrence. NEVER produced by the engine/worker —
     * resolved lazily on demand via `resolveResultCfi` (domains/search) with
     * an injected `cfiFromRange`. Optional so results stay cheap.
     */
    cfi?: string;
}

/** A bounded result page: the engine caps scans and SAYS so (no silent 50-cap). */
export interface SearchBatchResult {
    results: DetailedSearchResult[];
    /** True when more matches existed beyond the cap. */
    truncated: boolean;
}

/**
 * Represents a section of a book to be indexed.
 * Typically corresponds to a single spine item (chapter/file).
 */
export interface SearchSection {
    /** Unique identifier for the section. */
    id: string;
    /** Relative path/href to the section file. */
    href: string;
    /** The raw text content of the section. */
    text?: string;
    /** Optional display title (carried through to DetailedSearchResult.sectionTitle). */
    title?: string;
}
