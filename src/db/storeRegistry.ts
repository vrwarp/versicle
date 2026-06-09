/**
 * Tiny dependency-free registry that decouples DBService from the yjs-backed stores.
 *
 * DBService delegates some methods (book inventory, content analysis, annotations) to these
 * Zustand stores, but must NOT statically import them — otherwise the TTS engine worker (which
 * imports DBService for IndexedDB) would bundle yjs and open a second Y.Doc + IndexedDB
 * connection. So instead:
 *   - each store registers itself here on module-init (main thread), and
 *   - DBService reads the live store from here.
 *
 * This module imports the stores as *types only* (erased at build), so it has no runtime
 * dependency on yjs. It is intentionally not the DBService module, so tests that
 * `vi.mock('../db/DBService')` don't interfere with store registration.
 */
import type { useContentAnalysisStore } from '../store/useContentAnalysisStore';
import type { useBookStore } from '../store/useBookStore';
import type { useAnnotationStore } from '../store/useAnnotationStore';

let contentAnalysisStore: typeof useContentAnalysisStore | null = null;
let bookStore: typeof useBookStore | null = null;
let annotationStore: typeof useAnnotationStore | null = null;

export function setContentAnalysisStore(store: typeof useContentAnalysisStore): void { contentAnalysisStore = store; }
export function setBookStore(store: typeof useBookStore): void { bookStore = store; }
export function setAnnotationStore(store: typeof useAnnotationStore): void { annotationStore = store; }

export function getContentAnalysisStore(): typeof useContentAnalysisStore | null { return contentAnalysisStore; }
export function getBookStore(): typeof useBookStore | null { return bookStore; }
export function getAnnotationStore(): typeof useAnnotationStore | null { return annotationStore; }
