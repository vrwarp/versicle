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
// Artifact Lane Phase B (shared-ai-cache-design.md §2.2/§2.6): the PURE
// content-key + blob-header PARSE codec, so app/ reaches it via the published
// surface (mirrors the EmbeddingIndexer/chunkSection exports above). Serialize
// side is Phase C.
export { contentKey, parseArtifactBlob } from './artifactBlob';
export type { ArtifactStamp, ArtifactBlobHeader } from './artifactBlob';
// The quant stamp literal the artifact contentKey folds in (app/ builds the
// ArtifactStamp from the live config — useGenAIStore {model,dims} + this).
export { CURRENT_QUANT } from './embeddingPort';
