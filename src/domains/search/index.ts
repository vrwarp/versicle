/**
 * domains/search — public surface (Phase 7 §F).
 *
 * Reader adoption (providing a SearchSession via context to SearchPanel,
 * deleting the `searchClient` singleton + `scrollToText`) is the named
 * post-merge follow-up; until then the frozen reader keeps `lib/search.ts`.
 */
export {
  SearchSession,
  type SearchEngineFactory,
  type SearchEngineHandle,
  type SearchEngineProtocol,
  type SearchTextSource,
  type IndexOutcome,
} from './SearchSession';
export { createWorkerSearchEngineFactory } from './workerFactory';
export { findRangeForOffset, resolveResultCfi } from './offsetRange';
