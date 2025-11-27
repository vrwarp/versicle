import { Book } from 'epubjs';

/**
 * Represents the result of a search query within a book.
 */
export interface SearchResult {
    /** The reference (href) to the location in the book. */
    href: string;
    /** A snippet of text containing the search term. */
    excerpt: string;
    /** Optional Canonical Fragment Identifier (CFI) for the location. */
    cfi?: string;
}

/**
 * Client-side handler for interacting with the search worker.
 * Manages off-main-thread indexing and searching of books.
 */
class SearchClient {
    private worker: Worker | null = null;
    private listeners: Map<string, (data: unknown) => void> = new Map();

    /**
     * Retrieves the existing Web Worker instance or creates a new one if it doesn't exist.
     *
     * @returns The active Search Web Worker.
     */
    private getWorker() {
        if (!this.worker) {
             this.worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
                type: 'module'
            });

            this.worker.onmessage = (e) => {
                const { type, results } = e.data;
                if (type === 'SEARCH_RESULTS') {
                    const listener = this.listeners.get('SEARCH_RESULTS');
                    if (listener) listener(results);
                }
            };
        }
        return this.worker;
    }

    /**
     * Extracts text content from a book's spine items and sends it to the worker for indexing.
     *
     * @param book - The epubjs Book object to be indexed.
     * @param bookId - The unique identifier of the book.
     * @returns A Promise that resolves when the indexing command is sent to the worker.
     */
    async indexBook(book: Book, bookId: string) {
        // Extract text from all spine items
        // This can be slow, so we should do it carefully.
        // book.spine.each() iterates.

        const sections: { id: string; href: string; text: string }[] = [];

        // We need to wait for all sections to load
        // Note: loading all sections might be memory intensive for large books.
        // For production, maybe do this incrementally or only on demand.
        // For now, we load all.

        const spineItems = (book.spine as unknown as { items: unknown[] }).items;

        // Parallelize loading? Limit concurrency?
        // Let's do sequential for safety first.

        // @ts-expect-error epubjs types
        for (const item of spineItems) {
            try {
                // We use item.load(book.load) or similar.
                // Actually item.load returns a document?
                // item.url might be needed.

                // book.load(item.href) returns a document
                // @ts-expect-error epubjs types
                const doc = await book.load(item.href);
                if (doc) {
                    // Extract text
                    const text = doc.body.innerText; // or textContent
                    sections.push({
                        // @ts-expect-error epubjs types
                        id: item.id,
                        // @ts-expect-error epubjs types
                        href: item.href,
                        text: text
                    });
                }
            } catch (e) {
                console.warn(`Failed to index section ${item.href}`, e);
            }
        }

        this.getWorker().postMessage({
            type: 'INDEX_BOOK',
            payload: { bookId, sections }
        });
    }

    /**
     * Performs a search query against a specific book index via the worker.
     *
     * @param query - The text query to search for.
     * @param bookId - The unique identifier of the book to search.
     * @returns A Promise that resolves to an array of SearchResult objects.
     */
    search(query: string, bookId: string): Promise<SearchResult[]> {
        return new Promise((resolve) => {
            this.listeners.set('SEARCH_RESULTS', (data) => {
                resolve(data as SearchResult[]);
            });

            this.getWorker().postMessage({
                type: 'SEARCH',
                payload: { query, bookId }
            });
        });
    }

    /**
     * Terminates the search worker and cleans up resources.
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

/** A singleton instance of the SearchClient. */
export const searchClient = new SearchClient();
