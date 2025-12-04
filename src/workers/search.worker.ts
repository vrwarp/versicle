import { SearchEngine } from '../lib/search-engine';

/**
 * Defines the structure of messages sent to the search worker.
 */
export type SearchMessage =
  | { type: 'INDEX_BOOK'; id?: string; payload: { bookId: string; sections: { id: string; href: string; text: string }[] } }
  | { type: 'INIT_INDEX'; id?: string; payload: { bookId: string } }
  | { type: 'ADD_TO_INDEX'; id?: string; payload: { bookId: string; sections: { id: string; href: string; text: string }[] } }
  | { type: 'FINISH_INDEXING'; id?: string; payload: { bookId: string } }
  | { type: 'SEARCH'; id: string; payload: { query: string; bookId: string } };

const engine = new SearchEngine();

/**
 * Global message handler for the Web Worker.
 * Receives indexing and search commands and delegates them to the SearchEngine.
 *
 * @param e - The MessageEvent containing the command and payload.
 */
self.onmessage = async (e: MessageEvent<SearchMessage>) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { type, payload } = e.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = (e.data as any).id;

  try {
    if (type === 'INDEX_BOOK') {
      const { bookId, sections } = payload;
      engine.indexBook(bookId, sections);
      self.postMessage({ type: 'INDEX_COMPLETE', bookId, id });
    }
    else if (type === 'INIT_INDEX') {
      const { bookId } = payload;
      engine.initIndex(bookId);
      if (id) self.postMessage({ type: 'ACK', id });
    }
    else if (type === 'ADD_TO_INDEX') {
      const { bookId, sections } = payload;
      engine.addDocuments(bookId, sections);
      if (id) self.postMessage({ type: 'ACK', id });
    }
    else if (type === 'FINISH_INDEXING') {
      const { bookId } = payload;
      // Signal completion
      self.postMessage({ type: 'INDEX_COMPLETE', bookId, id });
    }
    else if (type === 'SEARCH') {
      const { query, bookId } = payload;
      const results = engine.search(bookId, query);
      self.postMessage({ type: 'SEARCH_RESULTS', id, results });
    }
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
