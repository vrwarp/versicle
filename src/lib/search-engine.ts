import FlexSearch from 'flexsearch';
import type { SearchResult, SearchSection } from '../types/search';

/**
 * Provides search functionality for book content using FlexSearch.
 * Handles indexing and querying of book sections.
 */
export class SearchEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private indexes = new Map<string, any>();

    /**
     * Initializes an empty index for a book, clearing any previous index.
     *
     * @param bookId - The unique identifier of the book.
     */
    initIndex(bookId: string) {
        const index = new FlexSearch.Document({
            id: "id",
            index: ["text"],
            store: ["href", "text"]
        });
        this.indexes.set(bookId, index);
    }

    /**
     * Adds documents to the index for a book. Creates the index if it doesn't exist.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections to add.
     */
    addDocuments(bookId: string, sections: SearchSection[]) {
        let index = this.indexes.get(bookId);
        if (!index) {
             index = new FlexSearch.Document({
                id: "id",
                index: ["text"],
                store: ["href", "text"]
            });
            this.indexes.set(bookId, index);
        }

        // Check if the number of documents being added is excessively large
        // to prevent potential memory issues or worker crashes.
        const LARGE_INDEX_THRESHOLD = 2000;
        if (sections.length > LARGE_INDEX_THRESHOLD) {
            console.warn(`Search Index Warning: Adding ${sections.length} documents. Index size may impact performance.`);
        }

        sections.forEach(section => {
            index.add({
                id: section.href,
                text: section.text,
                href: section.href
            });
        });
    }

    /**
     * Indexes a book's sections for searching.
     * Replace existing index.
     *
     * @param bookId - The unique identifier of the book.
     * @param sections - An array of sections containing text and location data to be indexed.
     */
    indexBook(bookId: string, sections: SearchSection[]) {
        this.initIndex(bookId);
        this.addDocuments(bookId, sections);
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

        // Escape regex special characters to safely use the query in a RegExp
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use a case-insensitive regex to find the match without copying the entire string
        const regex = new RegExp(escapedQuery, 'i');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return results.flatMap((entry: any) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            entry.result.map((match: any) => ({
                href: match.doc.href,
                excerpt: this.getExcerpt(match.doc.text, regex)
            }))
        );
    }

    /**
     * Generates a context excerpt for the found query in the text.
     *
     * @param text - The full text where the match was found.
     * @param regex - The compiled RegExp for the search query.
     * @returns A string snippet surrounding the matched term.
     */
    private getExcerpt(text: string, regex: RegExp): string {
        const match = regex.exec(text);

        if (!match) return text.substring(0, 100) + '...';

        const index = match.index;
        const matchLength = match[0].length;
        const start = Math.max(0, index - 40);
        const end = Math.min(text.length, index + matchLength + 40);

        return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
    }
}
