import type { SearchSection, DetailedSearchResult, SearchBatchResult } from '~types/search';

/**
 * In-memory full-text scan over a book's plain text (one entry per spine
 * section). Matching is a case-insensitive escaped-literal scan against the
 * ORIGINAL string (Phase 7 PR-S2): an escaped literal cannot backtrack — the
 * historical ReDoS concern applied to query-derived *patterns*, which this
 * engine never builds — and original-string offsets mean excerpts and
 * `charOffset` stay aligned even when lowercasing changes string length
 * (the Turkish-İ misalignment of the old lowercase-then-slice approach).
 *
 * Runs in the search worker (Comlink-exposed) or directly in tests.
 */
export class SearchEngine {
    // Stores content as: BookID -> (Href -> {text, title})
    private books = new Map<string, Map<string, { text: string; title?: string }>>();

    /** Default scan cap per query; the result says when it was hit. */
    static readonly DEFAULT_LIMIT = 50;

    /**
     * Initializes an empty storage for a book, clearing any previous data.
     *
     * @param bookId - The unique identifier of the book.
     */
    initIndex(bookId: string) {
        this.books.set(bookId, new Map());
    }

    /**
     * Adds documents (sections) to the store for a book.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections to add.
     */
    addDocuments(bookId: string, sections: SearchSection[]) {
        let bookStore = this.books.get(bookId);
        if (!bookStore) {
            bookStore = new Map();
            this.books.set(bookId, bookStore);
        }

        // Check if the number of documents being added is excessively large
        const LARGE_INDEX_THRESHOLD = 2000;
        if (sections.length > LARGE_INDEX_THRESHOLD) {
            console.warn(`Search Index Warning: Adding ${sections.length} documents. Index size may impact performance.`);
        }

        sections.forEach(section => {
            const text = section.text;
            if (text) {
                bookStore.set(section.href, { text, title: section.title });
            }
        });
    }

    /**
     * Indexes a book's sections for searching.
     * Replaces existing data for the book.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections containing text and location data to be indexed.
     */
    indexBook(bookId: string, sections: SearchSection[]) {
        this.initIndex(bookId);
        this.addDocuments(bookId, sections);
    }

    /**
     * Per-occurrence search (Phase 7 §F): every hit carries `charOffset`,
     * `matchLength` and a per-section `occurrence` ordinal so navigation can
     * land on the EXACT match; `truncated` replaces the silent result cap.
     */
    searchDetailed(
        bookId: string,
        query: string,
        opts: { limit?: number } = {},
    ): SearchBatchResult {
        const bookStore = this.books.get(bookId);
        const trimmed = query.trim();
        if (!bookStore || !trimmed) return { results: [], truncated: false };

        const limit = opts.limit ?? SearchEngine.DEFAULT_LIMIT;
        // Escaped LITERAL: user input is never interpreted as a pattern.
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'giu');

        const results: DetailedSearchResult[] = [];
        let truncated = false;

        outer: for (const [href, section] of bookStore.entries()) {
            pattern.lastIndex = 0;
            let occurrence = 0;
            let match: RegExpExecArray | null;

            while ((match = pattern.exec(section.text)) !== null) {
                // Escaped non-empty literals cannot match zero-width, but the
                // guard keeps the loop structurally safe.
                if (match[0].length === 0) {
                    pattern.lastIndex += 1;
                    continue;
                }
                occurrence += 1;

                if (results.length >= limit) {
                    truncated = true;
                    break outer;
                }

                results.push({
                    href,
                    sectionTitle: section.title,
                    excerpt: this.getExcerpt(section.text, match.index, match[0].length),
                    charOffset: match.index,
                    matchLength: match[0].length,
                    occurrence,
                });
            }
        }

        return { results, truncated };
    }

    /**
     * Generates a context excerpt around the match, sliced from the ORIGINAL
     * string with the ORIGINAL match offsets.
     *
     * @param text - The full text where the match was found.
     * @param index - The start index of the match.
     * @param length - The length of the match.
     * @returns A string snippet surrounding the matched term.
     */
    private getExcerpt(text: string, index: number, length: number): string {
        const start = Math.max(0, index - 40);
        const end = Math.min(text.length, index + length + 40);

        return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    }
}
