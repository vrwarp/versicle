import FlexSearch from 'flexsearch';

/**
 * Represents a search result containing a link and a text excerpt.
 */
export interface SearchResult {
    /** The reference (href) to the location in the book. */
    href: string;
    /** A snippet of text containing the search term. */
    excerpt: string;
}

/**
 * Provides search functionality for book content using FlexSearch.
 * Handles indexing and querying of book sections.
 */
export class SearchEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private indexes = new Map<string, any>();

    /**
     * Indexes a book's sections for searching.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections containing text and location data to be indexed.
     */
    indexBook(bookId: string, sections: { id: string; href: string; text: string }[]) {
        // @ts-expect-error FlexSearch types might be missing or different
        const index = new FlexSearch.Document({
            id: "id",
            index: ["text"],
            store: ["href", "text"]
        });

        sections.forEach(section => {
            index.add({
                id: section.href,
                text: section.text,
                href: section.href
            });
        });

        this.indexes.set(bookId, index);
    }

    /**
     * Searches a specific book for a query string.
     *
     * @param bookId - The unique identifier of the book to search.
     * @param query - The text query to search for.
     * @returns An array of SearchResult objects matching the query.
     */
    search(bookId: string, query: string): SearchResult[] {
        const index = this.indexes.get(bookId);
        if (!index) return [];

        const results = index.search(query, {
            enrich: true,
            limit: 50
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return results.flatMap((entry: any) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            entry.result.map((match: any) => ({
                href: match.doc.href,
                excerpt: this.getExcerpt(match.doc.text, query)
            }))
        );
    }

    /**
     * Generates a context excerpt for the found query in the text.
     *
     * @param text - The full text where the match was found.
     * @param query - The search query term.
     * @returns A string snippet surrounding the matched term.
     */
    private getExcerpt(text: string, query: string): string {
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index === -1) return text.substring(0, 100) + '...';

        const start = Math.max(0, index - 40);
        const end = Math.min(text.length, index + query.length + 40);

        return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    }
}
