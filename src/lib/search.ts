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

    /**
     * Retrieves the existing Web Worker instance or creates a new one if it doesn't exist.
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
     * Extracts text content from a book's spine items and sends it to the worker for indexing.
     * Uses batch processing to avoid blocking the main thread.
     *
     * @param book - The epubjs Book object to be indexed.
     * @param bookId - The unique identifier of the book.
     * @param onProgress - Optional callback for indexing progress (0.0 to 1.0).
     */
    async indexBook(book: Book, bookId: string, onProgress?: (percent: number) => void) {
        await book.ready;
        const engine = this.getEngine();

        // Init/Clear index
        await engine.initIndex(bookId);

        const spineItems = book.spine.items;
        const total = spineItems.length;
        const BATCH_SIZE = 5;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = spineItems.slice(i, i + BATCH_SIZE);
            const sections: SearchSection[] = [];

            for (const item of batch) {
                let text = '';
                try {
                    // Attempt 1: Access raw file content from the archive (fast & robust)
                    if (book.archive) {
                        try {
                            const blob = await book.archive.getBlob(item.href);
                            if (blob) {
                                const rawXml = await blob.text();
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(rawXml, 'application/xhtml+xml');
                                text = doc.body.textContent || '';
                            }
                        } catch (err) {
                            console.warn(`Archive extraction failed for ${item.href}, falling back to render`, err);
                        }
                    }

                    // Attempt 2: Fallback to rendering pipeline (slow but handles resource resolution)
                    if (!text) {
                        const doc = await book.load(item.href);
                        if (doc) {
                            if (doc.body && doc.body.innerText) {
                                text = doc.body.innerText;
                            } else if (doc.documentElement) {
                                text = doc.documentElement.innerText || '';
                            }
                        }
                    }

                    if (text) {
                        sections.push({
                            id: item.id,
                            href: item.href,
                            text: text
                        });
                    }
                } catch (e) {
                    console.warn(`Failed to index section ${item.href}`, e);
                }
            }

            if (sections.length > 0) {
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
        return this.getEngine().search(bookId, query);
    }

    /**
     * Terminates the search worker and cleans up resources.
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.engine = null;
        }
    }
}

/** A singleton instance of the SearchClient. */
export const searchClient = new SearchClient();
