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

type WorkerResponse =
    | { type: 'SEARCH_RESULTS'; id: string; results: SearchResult[] }
    | { type: 'ACK'; id: string }
    | { type: 'INDEX_COMPLETE'; bookId: string; id?: string }
    | { type: 'ERROR'; id?: string; error: string };

/**
 * Client-side handler for interacting with the search worker.
 * Manages off-main-thread indexing and searching of books.
 */
class SearchClient {
    private worker: Worker | null = null;
    private listeners: Map<string, (data: WorkerResponse) => void> = new Map();

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

            this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
                const { id } = e.data;
                if (id && this.listeners.has(id)) {
                    const listener = this.listeners.get(id);
                    if (listener) listener(e.data);
                }
            };

            this.worker.onerror = (e) => {
                console.error('Search worker error', e);
                // Reject all pending listeners
                for (const [, listener] of this.listeners) {
                    listener({ type: 'ERROR', error: 'Worker crashed' });
                }
                this.listeners.clear();
                this.terminate();
            };
        }
        return this.worker;
    }

    /**
     * Sends a message to the worker and waits for a response with a matching ID.
     *
     * @param type - The message type.
     * @param payload - The message payload.
     * @returns A Promise that resolves with the worker's response.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private sendMessage<T extends WorkerResponse>(type: string, payload: any): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const worker = this.getWorker();

            this.listeners.set(id, (response: WorkerResponse) => {
                if (response.type === 'ERROR') {
                    reject(new Error(response.error));
                } else {
                    resolve(response as T);
                }
                this.listeners.delete(id);
            });

            worker.postMessage({ type, id, payload });
        });
    }

    /**
     * Extracts text content from a book's spine items and sends it to the worker for indexing.
     * Uses batch processing to avoid blocking the main thread and confirms each batch.
     *
     * @param book - The epubjs Book object to be indexed.
     * @param bookId - The unique identifier of the book.
     * @param onProgress - Optional callback for indexing progress (0.0 to 1.0).
     * @returns A Promise that resolves when the indexing command is sent to the worker.
     */
    async indexBook(book: Book, bookId: string, onProgress?: (percent: number) => void) {
        // Init/Clear index
        await this.sendMessage('INIT_INDEX', { bookId });

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
                await this.sendMessage('ADD_TO_INDEX', { bookId, sections });
            }

            if (onProgress) {
                onProgress(Math.min(1.0, (i + batch.length) / total));
            }

            // Yield to main thread (optional if await sendMessage provides enough gap, but safer to keep)
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        await this.sendMessage('FINISH_INDEXING', { bookId });
    }

    /**
     * Performs a search query against a specific book index via the worker.
     *
     * @param query - The text query to search for.
     * @param bookId - The unique identifier of the book to search.
     * @returns A Promise that resolves to an array of SearchResult objects.
     */
    async search(query: string, bookId: string): Promise<SearchResult[]> {
        const response = await this.sendMessage<{ type: 'SEARCH_RESULTS'; id: string; results: SearchResult[] }>(
            'SEARCH',
            { query, bookId }
        );
        return response.results;
    }

    /**
     * Terminates the search worker and cleans up resources.
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            // Reject any remaining listeners?
            for (const [, listener] of this.listeners) {
                listener({ type: 'ERROR', error: 'Worker terminated' });
            }
            this.listeners.clear();
        }
    }
}

/** A singleton instance of the SearchClient. */
export const searchClient = new SearchClient();
