import FlexSearch from 'flexsearch';

// Define the worker's API
export type SearchMessage =
  | { type: 'INDEX_BOOK'; payload: { bookId: string; sections: { id: string; href: string; text: string }[] } }
  | { type: 'SEARCH'; payload: { query: string; bookId: string } };

export type SearchResult = {
    id: string; // section id/href
    match: string;
};

// Index storage: Map<bookId, FlexSearch.Index>
// FlexSearch Index type definition is a bit complex, utilizing 'any' for simplicity in this worker context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const indexes = new Map<string, any>();

// Create a map to store section data for context retrieval if needed
// Map<bookId, Map<id, text>>
const bookContent = new Map<string, Map<string, string>>();

self.onmessage = async (e: MessageEvent<SearchMessage>) => {
  const { type, payload } = e.data;

  if (type === 'INDEX_BOOK') {
    const { bookId, sections } = payload;

    // Initialize index
    // Using 'document' preset or just simple index depending on needs.
    // Document index allows storing whole docs. Simple index is just ID -> Text.
    // Let's use a Document index to store extra fields if needed, or just a simple Index.
    // For full-text search within a book, we want to know *which section* and *where*.

    // FlexSearch documentation is a bit fragmented.
    // New FlexSearch.Document({ ... })

    // @ts-expect-error FlexSearch types might be missing or different
    const index = new FlexSearch.Document({
        id: "id",
        index: ["text"],
        store: ["href", "text"] // We store text to extract snippets if needed
    });

    sections.forEach(section => {
        index.add({
            id: section.href, // Use href as ID
            text: section.text,
            href: section.href
        });
    });

    indexes.set(bookId, index);

    // Store content for snippet extraction (optional, FlexSearch store might handle it)
    const contentMap = new Map<string, string>();
    sections.forEach(s => contentMap.set(s.href, s.text));
    bookContent.set(bookId, contentMap);

    self.postMessage({ type: 'INDEX_COMPLETE', bookId });
  }

  else if (type === 'SEARCH') {
    const { query, bookId } = payload;
    const index = indexes.get(bookId);

    if (!index) {
        self.postMessage({ type: 'SEARCH_RESULTS', results: [] });
        return;
    }

    // Search
    // result format depends on FlexSearch configuration
    const results = index.search(query, {
        enrich: true,
        limit: 50
    });

    // Process results
    // FlexSearch 'enrich: true' returns: [{ field: 'text', result: [ { id, doc: { ... } } ] }]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processedResults = results.flatMap((entry: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry.result.map((match: any) => ({
            href: match.doc.href,
            // Create a snippet
            // We can use the stored text to find the query and show context
            excerpt: getExcerpt(match.doc.text, query)
        }))
    );

    self.postMessage({ type: 'SEARCH_RESULTS', results: processedResults });
  }
};

function getExcerpt(text: string, query: string): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) return text.substring(0, 100) + '...';

    const start = Math.max(0, index - 40);
    const end = Math.min(text.length, index + query.length + 40);

    return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}
