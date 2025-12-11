/**
 * Represents the result of a search query within a book.
 * Used by both the SearchEngine (to return results) and the UI (to display them).
 *
 * @example
 * ```ts
 * const result: SearchResult = {
 *   href: "chapter1.html",
 *   excerpt: "...found this text...",
 *   cfi: "epubcfi(/6/4!/4/2/1:0)"
 * };
 * ```
 */
export interface SearchResult {
    /** The reference (href) to the location in the book (e.g., 'chapter1.html'). */
    href: string;
    /** A snippet of text containing the search term, with surrounding context. */
    excerpt: string;
    /** Optional Canonical Fragment Identifier (CFI) for precise location navigation. */
    cfi?: string;
}

/**
 * Defines the available message types for communication between the main thread and the Search Worker.
 */
export type SearchRequestType =
    | 'INDEX_BOOK'
    | 'INIT_INDEX'
    | 'ADD_TO_INDEX'
    | 'FINISH_INDEXING'
    | 'SEARCH';

/**
 * Defines the possible response types from the Search Worker.
 */
export type SearchResponseType =
    | 'ACK'
    | 'SEARCH_RESULTS'
    | 'ERROR';

/**
 * Represents a section of a book to be indexed.
 * Typically corresponds to a single spine item (chapter/file).
 */
export interface SearchSection {
    /** Unique identifier for the section. */
    id: string;
    /** Relative path/href to the section file. */
    href: string;
    /** The raw text content of the section. */
    text: string;
}

/**
 * Discriminated Union of all possible requests sent to the Search Worker.
 * The `type` field is the discriminator.
 *
 * Usage:
 * - `INDEX_BOOK`: Indexes an entire book in one go (legacy/unused by batched client).
 * - `INIT_INDEX`: Initializes/clears the index for a book.
 * - `ADD_TO_INDEX`: Adds a batch of sections to the index.
 * - `FINISH_INDEXING`: Signals that all batches have been sent.
 * - `SEARCH`: Performs a search query.
 *
 * @example
 * ```ts
 * const req: SearchRequest = {
 *   id: "uuid-123",
 *   type: "SEARCH",
 *   payload: { query: "whale", bookId: "moby-dick" }
 * };
 * ```
 */
export type SearchRequest =
  | {
      id: string;
      type: 'INDEX_BOOK';
      payload: { bookId: string; sections: SearchSection[] }
    }
  | {
      id: string;
      type: 'INIT_INDEX';
      payload: { bookId: string }
    }
  | {
      id: string;
      type: 'ADD_TO_INDEX';
      payload: { bookId: string; sections: SearchSection[] }
    }
  | {
      id: string;
      type: 'FINISH_INDEXING';
      payload: { bookId: string }
    }
  | {
      id: string;
      type: 'SEARCH';
      payload: { query: string; bookId: string }
    };

/**
 * Discriminated Union of all possible responses from the Search Worker.
 * The `type` field is the discriminator.
 *
 * @example
 * ```ts
 * const res: SearchResponse = {
 *   id: "uuid-123",
 *   type: "SEARCH_RESULTS",
 *   results: [{ href: "chap1.html", excerpt: "..." }]
 * };
 * ```
 */
export type SearchResponse =
  /** Acknowledgment that a command (like INIT_INDEX) was received/processed. */
  | { id: string; type: 'ACK' }
  /** The result of a successful search query. */
  | { id: string; type: 'SEARCH_RESULTS'; results: SearchResult[] }
  /** Indicates that an error occurred during processing. */
  | { id: string; type: 'ERROR'; error: string };
