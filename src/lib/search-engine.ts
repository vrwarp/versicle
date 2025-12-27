import type { SearchResult, SearchSection } from '../types/search';

/**
 * Provides search functionality for book content using a simple RegExp scan.
 * Handles storage of raw text and linear scanning for queries.
 */
export class SearchEngine {
    // Stores content as: BookID -> (Href -> Text)
    private books = new Map<string, Map<string, string>>();

    /**
     * Initializes an empty storage for a book, clearing any previous data.
     *
     * @param bookId - The unique identifier of the book.
     */
    initIndex(bookId: string) {
        this.books.set(bookId, new Map<string, string>());
    }

    /**
     * Checks if the current environment supports XML parsing (DOMParser).
     * @returns True if DOMParser is available.
     */
    supportsXmlParsing(): boolean {
        return typeof DOMParser !== 'undefined';
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
            bookStore = new Map<string, string>();
            this.books.set(bookId, bookStore);
        }

        // Check if the number of documents being added is excessively large
        const LARGE_INDEX_THRESHOLD = 2000;
        if (sections.length > LARGE_INDEX_THRESHOLD) {
            console.warn(`Search Index Warning: Adding ${sections.length} documents. Index size may impact performance.`);
        }

        sections.forEach(section => {
            let text = section.text;

            // Offload XML parsing if text is missing but XML is provided
            if (!text && section.xml && typeof DOMParser !== 'undefined') {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(section.xml, 'application/xhtml+xml');
                    text = doc.body?.textContent || doc.documentElement?.textContent || '';
                } catch (e) {
                    console.warn(`Failed to parse XML for ${section.href}`, e);
                }
            }

            if (text) {
                bookStore.set(section.href, text);
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
     * Searches a specific book for a query string using linear RegExp scan.
     *
     * @param bookId - The unique identifier of the book to search.
     * @param query - The text query to search for.
     * @returns An array of SearchResult objects matching the query.
     */
    search(bookId: string, query: string): SearchResult[] {
        const bookStore = this.books.get(bookId);
        if (!bookStore || !query.trim()) return [];

        // Escape regex special characters to safely use the query in a RegExp
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Use a global, case-insensitive regex to find all matches
        const regex = new RegExp(escapedQuery, 'gi');

        const results: SearchResult[] = [];
        const MAX_RESULTS = 50;

        for (const [href, text] of bookStore.entries()) {
            // Reset lastIndex for each new string because we are reusing the regex object
            regex.lastIndex = 0;

            let match;
            while ((match = regex.exec(text)) !== null) {
                results.push({
                    href: href,
                    excerpt: this.getExcerpt(text, match.index, match[0].length)
                });

                if (results.length >= MAX_RESULTS) {
                    return results;
                }
            }
        }

        return results;
    }

    /**
     * Generates a context excerpt around the match.
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
