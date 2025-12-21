/**
 * Represents the result of a search query within a book.
 * Used by both the SearchEngine (to return results) and the UI (to display them).
 *
 * @example
 * ```ts
 * const result: SearchResult = {
 *   href: "chapter1.html",
 *   excerpt: "...found this text...",
 *   cfi: "epubcfi(/6/4!/4/2/1:0)"
 * };
 * ```
 */
export interface SearchResult {
    /** The reference (href) to the location in the book (e.g., 'chapter1.html'). */
    href: string;
    /** A snippet of text containing the search term, with surrounding context. */
    excerpt: string;
    /** Optional Canonical Fragment Identifier (CFI) for precise location navigation. */
    cfi?: string;
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
    /** The raw XML content of the section (optional, for worker-side parsing). */
    xml?: string;
}
