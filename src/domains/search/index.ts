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
// Artifact Lane Phase B/C (shared-ai-cache-design.md §2.2/§2.6): the PURE
// content-key + blob-header codec, so app/ reaches it via the published surface
// (mirrors the EmbeddingIndexer/chunkSection exports above). Phase B exported
// the PARSE side (consult/hydrate); Phase C adds the SERIALIZE side +
// ARTIFACT_HEADER_VERSION for the ArtifactPublisher upload boot task.
export {
  contentKey,
  parseArtifactBlob,
  serializeArtifactBlob,
  ARTIFACT_HEADER_VERSION,
} from './artifactBlob';
export type {
  ArtifactStamp,
  ArtifactBlobHeader,
  SerializableEmbeddingRow,
} from './artifactBlob';
// The quant stamp literal the artifact contentKey folds in (app/ builds the
// ArtifactStamp from the live config — useGenAIStore {model,dims} + this).
export { CURRENT_QUANT } from './embeddingPort';
