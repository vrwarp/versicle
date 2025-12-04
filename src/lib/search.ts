import type { Book } from 'epubjs';
import { v4 as uuidv4 } from 'uuid';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private pendingRequests: Map<string, { resolve: (data: any) => void; reject: (err: any) => void }> = new Map();

    /**
     * Retrieves the existing Web Worker instance or creates a new one if it doesn't exist.
     * Sets up the robust message handling protocol.
     *
     * @returns The active Search Web Worker.
     */
    private getWorker() {
        if (!this.worker) {
             this.worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
                type: 'module'
            });

            this.worker.onmessage = (e) => {
                const { id, type, results, error } = e.data;
                const pending = this.pendingRequests.get(id);

                if (pending) {
                    if (type === 'ERROR') {
                        pending.reject(new Error(error));
                    } else if (type === 'SEARCH_RESULTS') {
                        pending.resolve(results);
                    } else if (type === 'ACK') {
                        pending.resolve(null);
                    }
                    this.pendingRequests.delete(id);
                }
            };

            this.worker.onerror = (e) => {
                console.error('Search Worker Error:', e);
                // Reject all pending requests
                for (const { reject } of this.pendingRequests.values()) {
                    reject(new Error(`Worker error: ${e.message}`));
                }
                this.pendingRequests.clear();
            };
        }
        return this.worker;
    }

    /**
     * Sends a request to the worker and waits for the response.
     *
     * @param type - The message type.
     * @param payload - The payload data.
     * @returns A Promise resolving to the response data (or null for ACK).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private send(type: string, payload: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            this.pendingRequests.set(id, { resolve, reject });
            this.getWorker().postMessage({ id, type, payload });
        });
    }

    /**
     * Extracts text content from a book's spine items and sends it to the worker for indexing.
     * Uses batch processing to avoid blocking the main thread and robustly awaits worker acknowledgment.
     *
     * @param book - The epubjs Book object to be indexed.
     * @param bookId - The unique identifier of the book.
     * @param onProgress - Optional callback for indexing progress (0.0 to 1.0).
     * @returns A Promise that resolves when the indexing command is sent to the worker.
     */
    async indexBook(book: Book, bookId: string, onProgress?: (percent: number) => void) {
        // Init/Clear index
        await this.send('INIT_INDEX', { bookId });

        const spineItems = (book.spine as unknown as { items: unknown[] }).items;
        const total = spineItems.length;
        const BATCH_SIZE = 5;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = spineItems.slice(i, i + BATCH_SIZE);
            const sections: { id: string; href: string; text: string }[] = [];

            for (const item of batch) {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const doc = await (book as any).load((item as any).href);
                    if (doc) {
                        const text = doc.body.innerText;
                        sections.push({
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            id: (item as any).id,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            href: (item as any).href,
                            text: text
                        });
                    }
                } catch (e) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    console.warn(`Failed to index section ${(item as any).href}`, e);
                }
            }

            if (sections.length > 0) {
                // Wait for the worker to acknowledge receipt and addition of this batch
                await this.send('ADD_TO_INDEX', { bookId, sections });
            }

            if (onProgress) {
                onProgress(Math.min(1.0, (i + batch.length) / total));
            }

            // Yield to main thread (still useful to let UI render between extraction steps,
            // though await send() already yields, explicit yield ensures checking event loop)
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        await this.send('FINISH_INDEXING', { bookId });
    }

    /**
     * Performs a search query against a specific book index via the worker.
     *
     * @param query - The text query to search for.
     * @param bookId - The unique identifier of the book to search.
     * @returns A Promise that resolves to an array of SearchResult objects.
     */
    async search(query: string, bookId: string): Promise<SearchResult[]> {
        return this.send('SEARCH', { query, bookId });
    }

    /**
     * Terminates the search worker and cleans up resources.
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;

            // Reject any pending requests since the worker is dead
            for (const { reject } of this.pendingRequests.values()) {
                reject(new Error('Worker terminated'));
            }
            this.pendingRequests.clear();
        }
    }
}

/** A singleton instance of the SearchClient. */
export const searchClient = new SearchClient();
