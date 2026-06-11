/**
 * The synced-store roster: every Yjs-backed store with the Y.Map name it
 * replicates into. The boot `whenHydrated` composition iterates this list to
 * mark empty-map stores hydrated and await the rest
 * (phase2-fork-surgery.md §2.4 provider composition).
 *
 * This is the minimal precursor of the P2 store registry
 * (`defineSyncedStore` + three-tier declaration, §2.5) — when the registry
 * lands, this module dissolves into it. Map names are intentionally
 * duplicated from the store modules (the middleware does not expose them);
 * the registry consolidates that duplication.
 */
import type { YjsStoreHandle } from 'zustand-middleware-yjs';
import { getDeviceId } from '@lib/device-id';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useAnnotationStore } from './useAnnotationStore';
import { usePreferencesStore } from './usePreferencesStore';
import { useReadingListStore } from './useReadingListStore';
import { useVocabularyStore } from './useVocabularyStore';
import { useLexiconStore } from './useLexiconStore';
import { useContentAnalysisStore } from './useContentAnalysisStore';
import { useDeviceStore } from './useDeviceStore';

export interface SyncedStoreEntry {
  /** Top-level Y.Map name the store replicates into. */
  mapName: string;
  /** The store api object (the middleware attaches `api.yjs` to it). */
  store: object;
}

/**
 * The store's hydration handle, or undefined when the module is a test mock
 * without the middleware augmentation (App_Boot.test.tsx mocks store
 * modules wholesale). Production stores always carry `api.yjs`.
 */
export const yjsHandleOf = (store: object): YjsStoreHandle | undefined =>
  (store as { yjs?: YjsStoreHandle }).yjs;

/** All nine synced stores. Order is irrelevant (hydration is awaited as a set). */
export const SYNCED_STORES: readonly SyncedStoreEntry[] = [
  { mapName: 'library', store: useBookStore },
  { mapName: 'progress', store: useReadingStateStore },
  { mapName: 'annotations', store: useAnnotationStore },
  // Per-device map until the v6 preferences fold's store rebind (flip item).
  { mapName: `preferences/${getDeviceId()}`, store: usePreferencesStore },
  { mapName: 'reading-list', store: useReadingListStore },
  { mapName: 'vocabulary', store: useVocabularyStore },
  { mapName: 'lexicon', store: useLexiconStore },
  { mapName: 'contentAnalysis', store: useContentAnalysisStore },
  { mapName: 'devices', store: useDeviceStore },
];
