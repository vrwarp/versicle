import * as Comlink from 'comlink';
import type { Book } from 'epubjs';
import type { SearchResult, SearchSection } from '../types/search';
import type { SearchEngine } from './search-engine';

export type { SearchResult };

/**
 * Client-side handler for interacting with the search worker.
 * Manages off-main-thread indexing and searching of books.
 */
class SearchClient {
    private worker: Worker | null = null;
    private engine: Comlink.Remote<SearchEngine> | null = null;
    private indexedBooks = new Set<string>();
    private pendingIndexes = new Map<string, Promise<void>>();

    /**
     * Retrieves the existing Web Worker instance or creates a new one if it doesn't exist.
     * Uses Comlink to wrap the worker.
     *
     * @returns The active Search Web Worker proxy.
     */
    private getEngine() {
        if (!this.engine) {
             this.worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
                type: 'module'
            });
            this.engine = Comlink.wrap<SearchEngine>(this.worker);
        }
        return this.engine;
    }

    /**
     * Checks if a book is already indexed.
     */
    isIndexed(bookId: string): boolean {
        return this.indexedBooks.has(bookId);
    }

    /**
     * Extracts text content from a book's spine items and sends it to the worker for indexing.
     * Uses batch processing to avoid blocking the main thread.
     *
     * @param book - The epubjs Book object to be indexed.
     * @param bookId - The unique identifier of the book.
     * @param onProgress - Optional callback for indexing progress (0.0 to 1.0).
     * @returns A Promise that resolves when the indexing command is sent to the worker.
     */
    async indexBook(book: Book, bookId: string, onProgress?: (percent: number) => void) {
        if (this.indexedBooks.has(bookId)) {
            if (onProgress) onProgress(1.0);
            return;
        }

        if (this.pendingIndexes.has(bookId)) {
            // Wait for pending index
            await this.pendingIndexes.get(bookId);
            if (onProgress) onProgress(1.0);
            return;
        }

        const task = this.indexBookInternal(book, bookId, onProgress);
        this.pendingIndexes.set(bookId, task);

        try {
            await task;
            this.indexedBooks.add(bookId);
        } finally {
            this.pendingIndexes.delete(bookId);
        }
    }

    private async indexBookInternal(book: Book, bookId: string, onProgress?: (percent: number) => void) {
        const engine = this.getEngine();
        await book.ready;
        // Init/Clear index
        await engine.initIndex(bookId);

        // Check if worker supports XML parsing to offload main thread
        const canOffload = await engine.supportsXmlParsing();

        const spineItems = book.spine.items;
        const total = spineItems.length;
        const BATCH_SIZE = 5;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = spineItems.slice(i, i + BATCH_SIZE);
            const sections: SearchSection[] = [];

            for (const item of batch) {
                let text = '';
                let xml = '';
                try {
                    // Attempt 1: Access raw file content from the archive (fast & robust)
                    if (book.archive) {
                        try {
                            const blob = await book.archive.getBlob(item.href);
                            if (blob) {
                                const rawXml = await blob.text();
                                if (canOffload) {
                                    xml = rawXml;
                                } else {
                                    const parser = new DOMParser();
                                    const doc = parser.parseFromString(rawXml, 'application/xhtml+xml');
                                    text = doc.body.textContent || '';
                                }
                            }
                        } catch (err) {
                            console.warn(`Archive extraction failed for ${item.href}, falling back to render`, err);
                        }
                    }

                    // Attempt 2: Fallback to rendering pipeline (slow but handles resource resolution)
                    if (!text && !xml) {
                        const doc = await book.load(item.href);
                        if (doc) {
                            if (doc.body && doc.body.innerText) {
                                text = doc.body.innerText;
                            } else if (doc.documentElement) {
                                text = doc.documentElement.innerText || '';
                            }
                        }
                    }

                    if (text || xml) {
                        sections.push({
                            id: item.id,
                            href: item.href,
                            text: text || undefined,
                            xml: xml || undefined
                        });
                    }
                } catch (e) {
                    console.warn(`Failed to index section ${item.href}`, e);
                }
            }

            if (sections.length > 0) {
                // Wait for the worker to acknowledge receipt and addition of this batch
                await engine.addDocuments(bookId, sections);
            }

            if (onProgress) {
                onProgress(Math.min(1.0, (i + batch.length) / total));
            }

            // Yield to main thread
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /**
     * Performs a search query against a specific book index via the worker.
     *
     * @param query - The text query to search for.
     * @param bookId - The unique identifier of the book to search.
     * @returns A Promise that resolves to an array of SearchResult objects.
     */
    async search(query: string, bookId: string): Promise<SearchResult[]> {
        const engine = this.getEngine();
        return engine.search(bookId, query);
    }

    /**
     * Terminates the search worker and cleans up resources.
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.engine = null;
            this.indexedBooks.clear();
            this.pendingIndexes.clear();
        }
    }
}

/** A singleton instance of the SearchClient. */
export const searchClient = new SearchClient();
