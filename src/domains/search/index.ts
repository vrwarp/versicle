/**
 * domains/search — public surface (Phase 7 §F).
 *
 * Consumed by the reader controller (one SearchSession per open reader,
 * SearchPanel fed through props) since the post-merge reader adoption — the
 * `searchClient` singleton, `scrollToText` and the legacy result shape died
 * with it.
 */
export {
  SearchSession,


  type SearchEngineProtocol,


} from './SearchSession';
export { createWorkerSearchEngineFactory } from './workerFactory';
export {  resolveResultCfi } from './offsetRange';
// Increment C §4: the foreground document-embedding indexer + the chunker, so
// app/ can construct the indexer and any in-domain consumer reaches the chunker
// via the published surface.
export { EmbeddingIndexer } from './EmbeddingIndexer';
export { chunkSection } from './chunker';
