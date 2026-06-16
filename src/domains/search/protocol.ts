/**
 * The engine + corpus PORT contracts the search session and its semantic query
 * path share (Phase 7 §F + Increment D). Declared in their OWN module so the
 * session (SearchSession.ts) and the semantic ranker (semanticRank.ts) both
 * depend on the types here without forming an import cycle through each other.
 *
 * `SearchSession.ts` re-exports {@link SearchEngineProtocol} so the published
 * domain surface (index.ts) is unchanged.
 */
import type { SearchBatchResult, SearchSection } from '~types/search';

/** The engine surface the session needs — satisfied by the real SearchEngine and its Comlink remote. */
export interface SearchEngineProtocol {
  initIndex(bookId: string): void | Promise<void>;
  addDocuments(bookId: string, sections: SearchSection[]): void | Promise<void>;
  searchDetailed(
    bookId: string,
    query: string,
    opts?: { limit?: number },
  ): SearchBatchResult | Promise<SearchBatchResult>;
  /**
   * Rank packed int8 corpus rows by cosine against an int8 query vector
   * (Increment D §2). Crosses the worker seam like searchDetailed: the real
   * SearchEngine runs it in-process in tests and as a Comlink remote in prod
   * (hence the `| Promise<...>` return).
   */
  rankInt8(
    packedVecs: Int8Array,
    scales: Float32Array,
    queryVec: Int8Array,
    queryScale: number,
    dims: number,
    limit: number,
  ): { row: number; cosine: number }[] | Promise<{ row: number; cosine: number }[]>;
}

export interface SearchEngineHandle {
  engine: SearchEngineProtocol;
  /** Release the underlying resource (terminate the worker). */
  dispose(): void;
  /** Subscribe to fatal engine errors (worker `onerror`). Returns unsubscribe. */
  onError?(listener: (error: unknown) => void): () => void;
}

export type SearchEngineFactory = () => SearchEngineHandle;

/** Read access to the persisted corpus (the data repo, injected to keep this module store/data-free in tests). */
export interface SearchTextSource {
  get(bookId: string): Promise<
    | {
        extractionVersion: number;
        sections: {
          href: string;
          title: string;
          text: string;
          /** Embedding-indexer skip key, stamped at import (Increment C §3). */
          sectionTextHash?: string;
        }[];
      }
    | undefined
  >;
}
