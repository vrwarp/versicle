import { SearchEngine } from '../lib/search-engine';

/**
 * Defines the structure of messages sent to the search worker.
 * Each message must include a unique 'id' to correlate with the response.
 */
export type SearchRequest =
  | { id: string; type: 'INDEX_BOOK'; payload: { bookId: string; sections: { id: string; href: string; text: string }[] } }
  | { id: string; type: 'INIT_INDEX'; payload: { bookId: string } }
  | { id: string; type: 'ADD_TO_INDEX'; payload: { bookId: string; sections: { id: string; href: string; text: string }[] } }
  | { id: string; type: 'FINISH_INDEXING'; payload: { bookId: string } }
  | { id: string; type: 'SEARCH'; payload: { query: string; bookId: string } };

/**
 * Defines the structure of responses sent back to the main thread.
 */
export type SearchResponse =
  | { id: string; type: 'ACK' }
  | { id: string; type: 'SEARCH_RESULTS'; results: any[] }
  | { id: string; type: 'ERROR'; error: string };

const engine = new SearchEngine();

/**
 * Global message handler for the Web Worker.
 * Receives indexing and search commands and delegates them to the SearchEngine.
 * Wraps operations in try-catch to ensure robust error reporting.
 *
 * @param e - The MessageEvent containing the command and payload.
 */
self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const { id, type, payload } = e.data;

  try {
    if (type === 'INDEX_BOOK') {
      const { bookId, sections } = payload;
      engine.indexBook(bookId, sections);
      self.postMessage({ id, type: 'ACK' });
    }

    else if (type === 'INIT_INDEX') {
      const { bookId } = payload;
      engine.initIndex(bookId);
      self.postMessage({ id, type: 'ACK' });
    }

    else if (type === 'ADD_TO_INDEX') {
      const { bookId, sections } = payload;
      engine.addDocuments(bookId, sections);
      self.postMessage({ id, type: 'ACK' });
    }

    else if (type === 'FINISH_INDEXING') {
      // Potentially optimize index here if needed in future
      self.postMessage({ id, type: 'ACK' });
    }

    else if (type === 'SEARCH') {
      const { query, bookId } = payload;
      const results = engine.search(bookId, query);
      self.postMessage({ id, type: 'SEARCH_RESULTS', results });
    }
  } catch (err) {
    self.postMessage({
      id,
      type: 'ERROR',
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
