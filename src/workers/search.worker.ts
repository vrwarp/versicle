import { SearchEngine } from '../lib/search-engine';

// Define the worker's API
export type SearchMessage =
  | { type: 'INDEX_BOOK'; payload: { bookId: string; sections: { id: string; href: string; text: string }[] } }
  | { type: 'SEARCH'; payload: { query: string; bookId: string } };

const engine = new SearchEngine();

self.onmessage = async (e: MessageEvent<SearchMessage>) => {
  const { type, payload } = e.data;

  if (type === 'INDEX_BOOK') {
    const { bookId, sections } = payload;
    engine.indexBook(bookId, sections);
    self.postMessage({ type: 'INDEX_COMPLETE', bookId });
  }

  else if (type === 'SEARCH') {
    const { query, bookId } = payload;
    const results = engine.search(bookId, query);
    self.postMessage({ type: 'SEARCH_RESULTS', results });
  }
};
