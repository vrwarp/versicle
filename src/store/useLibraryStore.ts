import { create } from 'zustand';
import type { BookMetadata } from '~types/book';
import type { BatchImportSummary } from '@domains/library/ports';
import { useBookStore } from './useBookStore';

export type { BatchImportSummary };

/**
 * The library UI PROJECTION (Phase 7 §D — shrunk from the 841-line workflow
 * store). Transient, local-only state that components render:
 *
 *  - the static-metadata cache + offloaded set (written by LibraryService
 *    through the projection port; see src/app/library/createLibrary.ts),
 *  - the import job-progress projection (written by the ImportOrchestrator),
 *  - the last error surfaced by a library workflow.
 *
 * EVERY workflow (import/restore/remove/offload/reprocess/hydrate) lives in
 * domains/library — components call the controller
 * (src/app/library/useImportController.ts), never this store. The actions
 * below are the projection port's primitives: per-key only (the I-5
 * discipline is structural — there is no wholesale offloaded setter).
 */
interface LibraryState {
  /** Static metadata cache (title, author, cover) from static_manifests. */
  staticMetadata: Record<string, BookMetadata>;
  /** Set of book IDs that are offloaded (locally missing binary content). */
  offloadedBookIds: Set<string>;
  isHydrating: boolean;
  hasHydrated: boolean;
  isLoading: boolean;
  isImporting: boolean;
  /** Progress percentage of the current import (0-100). */
  importProgress: number;
  importStatus: string;
  /** Progress percentage of the current upload/extraction (0-100). */
  uploadProgress: number;
  uploadStatus: string;
  /** Per-file outcome summary of the last batch import, or null if none/dismissed. */
  batchImportSummary: BatchImportSummary | null;
  /** Error message if an operation failed, or null. */
  error: string | null;

  // === Projection primitives (the LibraryProjectionPort surface) ===
  setStaticMetadata: (bookId: string, meta: BookMetadata) => void;
  removeStaticMetadata: (bookId: string) => void;
  markOffloaded: (bookId: string) => void;
  unmarkOffloaded: (bookId: string) => void;
  setHydrating: (isHydrating: boolean) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setError: (message: string | null) => void;
  importStarted: () => void;
  setImportProgress: (progress: number, message: string) => void;
  setUploadProgress: (percent: number, status: string) => void;
  importFinished: () => void;
  setBatchImportSummary: (summary: BatchImportSummary | null) => void;
  /** Clears the per-file batch import summary (e.g. when the user dismisses it). */
  clearBatchImportSummary: () => void;
}

export const useLibraryStore = create<LibraryState>()((set) => ({
  staticMetadata: {},
  offloadedBookIds: new Set<string>(),
  isHydrating: false,
  hasHydrated: false,
  isLoading: false,
  isImporting: false,
  importProgress: 0,
  importStatus: '',
  uploadProgress: 0,
  uploadStatus: '',
  batchImportSummary: null,
  error: null,

  setStaticMetadata: (bookId, meta) =>
    set((state) => {
      if (state.staticMetadata[bookId] === meta) return state;
      return { staticMetadata: { ...state.staticMetadata, [bookId]: meta } };
    }),

  removeStaticMetadata: (bookId) =>
    set((state) => {
      if (!(bookId in state.staticMetadata)) return state;
      const next = { ...state.staticMetadata };
      delete next[bookId];
      return { staticMetadata: next };
    }),

  markOffloaded: (bookId) =>
    set((state) => {
      if (state.offloadedBookIds.has(bookId)) return state;
      return { offloadedBookIds: new Set(state.offloadedBookIds).add(bookId) };
    }),

  unmarkOffloaded: (bookId) =>
    set((state) => {
      if (!state.offloadedBookIds.has(bookId)) return state;
      const next = new Set(state.offloadedBookIds);
      next.delete(bookId);
      return { offloadedBookIds: next };
    }),

  setHydrating: (isHydrating) => set({ isHydrating }),
  setHasHydrated: (hasHydrated) => set({ hasHydrated }),
  setError: (error) => set({ error }),

  importStarted: () =>
    set({
      isImporting: true,
      importProgress: 0,
      importStatus: 'Starting import...',
      uploadProgress: 0,
      uploadStatus: '',
      error: null,
    }),

  setImportProgress: (importProgress, importStatus) => set({ importProgress, importStatus }),
  setUploadProgress: (uploadProgress, uploadStatus) => set({ uploadProgress, uploadStatus }),

  importFinished: () =>
    set({ isImporting: false, importProgress: 0, importStatus: '', uploadProgress: 0, uploadStatus: '' }),

  setBatchImportSummary: (batchImportSummary) => set({ batchImportSummary }),
  clearBatchImportSummary: () => set({ batchImportSummary: null }),
}));

// Re-export kept for the modules that imported the inventory store through
// this file historically (debug affordance; selectors).
export { useBookStore };
