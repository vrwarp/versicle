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
  type SearchEngineHandle,
} from './SearchSession';
export { createWorkerSearchEngineFactory } from './workerFactory';
export {  resolveResultCfi } from './offsetRange';
// The foreground document-embedding indexer + the chunker, so app/ can
// construct the indexer and any in-domain consumer reaches the chunker via the
// published surface.
export { EmbeddingIndexer } from './EmbeddingIndexer';
export { chunkSection, segmentSentences, type Sentence } from './chunker';
// The pure codec for the shared embedding cache: contentKey hashes a book's
// embedding inputs into a content-addressed key, and the blob (de)serializers
// pack/unpack the stored vector rows with a versioned header. Exported so app/
// can both read a downloaded cache blob and serialize one for upload (mirrors
// the EmbeddingIndexer/chunkSection exports above). ARTIFACT_HEADER_VERSION
// stamps the on-the-wire format. (design: plan/shared-ai-cache-design.md)
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
// The current vector quantization scheme, named so it can identify which
// embedding space a cached blob belongs to. The cache key is computed from the
// embedding {model, dims} plus this, so a change here makes old cached blobs
// miss and be recomputed rather than be read in the wrong space. Exported so
// app/ can fold it into the stamp it builds from the live config
// (useGenAIStore {model, dims} + this).
export { CURRENT_QUANT } from './embeddingPort';
export { QueryEmbeddingCache } from './queryEmbeddingCache';
