import { SearchEngine } from '../lib/search-engine';
import type { SearchRequest } from '../types/search';

const engine = new SearchEngine();

/**
 * Global message handler for the Web Worker.
 * Receives indexing and search commands and delegates them to the SearchEngine.
 * Wraps operations in try-catch to ensure robust error reporting.
 *
 * @param e - The MessageEvent containing the command and payload.
 */
self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const request = e.data;
  const { id } = request;

  try {
    if (request.type === 'INDEX_BOOK') {
      const { bookId, sections } = request.payload;
      engine.indexBook(bookId, sections);
      self.postMessage({ id, type: 'ACK' });
    }

    else if (request.type === 'INIT_INDEX') {
      const { bookId } = request.payload;
      engine.initIndex(bookId);
      self.postMessage({ id, type: 'ACK' });
    }

    else if (request.type === 'ADD_TO_INDEX') {
      const { bookId, sections } = request.payload;
      engine.addDocuments(bookId, sections);
      self.postMessage({ id, type: 'ACK' });
    }

    else if (request.type === 'FINISH_INDEXING') {
      // Potentially optimize index here if needed in future
      self.postMessage({ id, type: 'ACK' });
    }

    else if (request.type === 'SEARCH') {
      const { query, bookId } = request.payload;
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
