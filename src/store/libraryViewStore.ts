/**
 * libraryViewStore — the derived library projection (Phase 7 §D, PR-L5).
 *
 * Replaces `selectors.ts`'s render-time machinery: the module-level mutable
 * cache block (`createModuleCache`, 12 eslint-disables of `any`) and the
 * render-time fuzzy `generateMatchKey` joins. The store recomputes
 * OFF-RENDER on subscription deltas from its input stores — strictly less
 * work than render-time recompute — and keeps the WeakMap per-book
 * memoization that made the old hook cheap (reference stability for
 * unchanged books is pinned by selectors.test.ts, re-pointed).
 *
 * Reading-list join order (§D): the `bookId` FK written at registration
 * time wins; exact `sourceFilename` next; the fuzzy title+author key LAST —
 * the fallback that keeps pre-linking entries working (it dies post-merge,
 * one release after the linking migration registers).
 */
import { create } from 'zustand';
import { useBookStore } from './useBookStore';
import { useLibraryStore } from './useLibraryStore';
import { useReadingStateStore, isValidProgress, getMostRecentProgress } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import type { UserInventoryItem, UserProgress, ReadingListEntry, BookMetadata, NavigationItem } from '~types/db';
import { getDeviceId } from '@lib/device-id';
import { generateMatchKey } from '@lib/entity-resolution';
import { coverUrl as buildCoverUrl } from '@data/covers';

/** The typed view row — kills the `(book as unknown as {allProgress?})` casts (BookCard). */
export interface LibraryBook extends UserInventoryItem {
  /** Alias of bookId for legacy call sites. */
  id: string;
  coverBlob?: Blob;
  coverUrl?: string;
  version?: number;
  fileHash?: string;
  fileSize?: number;
  totalChars?: number;
  syntheticToc?: NavigationItem[];
  isOffloaded: boolean;
  /** Resolved progress (Local Priority > Global Recent), reading-list fallback. */
  progress: number;
  currentCfi?: string;
  lastRead: number;
  /** Per-device progress map (drives the remote-resume affordances). */
  allProgress?: Record<string, UserProgress>;
  /** The joined reading-list entry, when one matched. */
  readingListEntry?: ReadingListEntry;
}

interface LibraryViewState {
  books: LibraryBook[];
}

export const useLibraryViewStore = create<LibraryViewState>()(() => ({ books: [] }));

/**
 * Resolves the progress for a book using the "Local Priority > Global Recent"
 * strategy. Matches useReadingStateStore.getProgress().
 */
function resolveProgress(
  bookProgress: Record<string, UserProgress> | undefined,
  deviceId: string,
): UserProgress | null {
  if (!bookProgress) return null;
  const local = bookProgress[deviceId];
  if (local && isValidProgress(local)) return local;
  const recent = getMostRecentProgress(bookProgress);
  if (recent) return recent;
  return local || null;
}

// ── Memoization caches (written off-render only) ──────────────────────────

type BaseBook = Omit<LibraryBook, 'progress' | 'currentCfi' | 'lastRead' | 'allProgress' | 'readingListEntry'>;

interface ResultCacheEntry {
  result: LibraryBook;
  base: BaseBook;
  rawBookProgress: Record<string, UserProgress> | undefined;
  rawReadingListEntry: ReadingListEntry | undefined;
}

const caches = {
  baseBookCache: new WeakMap<UserInventoryItem, BaseBook>(),
  baseBooks: [] as BaseBook[],
  lastPhase1: {
    books: undefined as Record<string, UserInventoryItem> | undefined,
    staticMetadata: undefined as Record<string, BookMetadata> | undefined,
    offloadedBookIds: undefined as ReadonlySet<string> | undefined,
  },
  matchMap: new Map<string, ReadingListEntry>(),
  fkMap: new Map<string, ReadingListEntry>(),
  lastEntries: undefined as Record<string, ReadingListEntry> | undefined,
  resultCache: new Map<string, ResultCacheEntry>(),
  lastPhase2: {
    baseBooks: undefined as BaseBook[] | undefined,
    progress: undefined as Record<string, Record<string, UserProgress>> | undefined,
    entries: undefined as Record<string, ReadingListEntry> | undefined,
  },
};

/** Recompute the projection from the input stores' CURRENT state. Idempotent and cheap on no-ops. */
export function recomputeLibraryView(): void {
  const books = useBookStore.getState().books;
  const libraryState = useLibraryStore.getState();
  const staticMetadata = libraryState.staticMetadata || {};
  const offloadedBookIds = libraryState.offloadedBookIds || new Set<string>();
  const progressMap = useReadingStateStore.getState().progress;
  const entries = useReadingListStore.getState().entries;

  // Phase 1 — base books (inventory ⋈ static metadata ⋈ offloaded). Rare changes.
  const phase1Changed =
    caches.lastPhase1.books !== books ||
    caches.lastPhase1.staticMetadata !== staticMetadata ||
    caches.lastPhase1.offloadedBookIds !== offloadedBookIds;

  if (phase1Changed) {
    if (
      caches.lastPhase1.staticMetadata !== staticMetadata ||
      caches.lastPhase1.offloadedBookIds !== offloadedBookIds
    ) {
      caches.baseBookCache = new WeakMap();
    }

    const result: BaseBook[] = [];
    for (const key in books) {
      if (!Object.prototype.hasOwnProperty.call(books, key)) continue;
      const book = books[key];
      if (!book) continue;

      const cached = caches.baseBookCache.get(book);
      if (cached) {
        result.push(cached);
        continue;
      }

      const meta = staticMetadata[book.bookId];
      const hasCoverBlob = meta?.coverBlob instanceof Blob;

      const baseBook: BaseBook = {
        ...book,
        id: book.bookId,
        // Prioritize user overrides (Yjs) > Static/Legacy Metadata > Snapshot
        title: book.customTitle || meta?.title || book.title,
        author: book.customAuthor || meta?.author || book.author,
        coverBlob: meta?.coverBlob,
        version: meta?.version || undefined,
        // SW cover route via the shared coverUrl() helper (P3) — never
        // re-inline the endpoint string.
        coverUrl: hasCoverBlob ? buildCoverUrl(book.bookId) : undefined,
        fileHash: meta?.fileHash,
        fileSize: meta?.fileSize,
        totalChars: meta?.totalChars,
        syntheticToc: meta?.syntheticToc,
        isOffloaded: offloadedBookIds.has(book.bookId),
      };

      caches.baseBookCache.set(book, baseBook);
      result.push(baseBook);
    }

    caches.baseBooks = result.sort((a, b) => (b.lastInteraction ?? 0) - (a.lastInteraction ?? 0));
    caches.lastPhase1 = { books, staticMetadata, offloadedBookIds };
  }

  // Reading-list join maps — FK first, fuzzy fallback precomputed once per
  // entries change (no O(N·M) render-time parsing).
  if (caches.lastEntries !== entries) {
    const fkMap = new Map<string, ReadingListEntry>();
    const matchMap = new Map<string, ReadingListEntry>();
    for (const key in entries) {
      if (!Object.prototype.hasOwnProperty.call(entries, key)) continue;
      const entry = entries[key];
      if (entry.bookId) fkMap.set(entry.bookId, entry);
      const matchKey = generateMatchKey(entry.title, entry.author);
      if (matchKey && !matchMap.has(matchKey)) matchMap.set(matchKey, entry);
    }
    caches.fkMap = fkMap;
    caches.matchMap = matchMap;
    caches.lastEntries = entries;
  }

  // Phase 2 — progress + reading-list merge (frequent: every page turn).
  const phase2Changed =
    caches.lastPhase2.baseBooks !== caches.baseBooks ||
    caches.lastPhase2.progress !== progressMap ||
    caches.lastPhase2.entries !== entries;

  if (!phase2Changed) return;

  const deviceId = getDeviceId();
  const nextCache = new Map<string, ResultCacheEntry>();
  let anyBookChanged = false;

  const result = caches.baseBooks.map((base) => {
    const rawBookProgress = progressMap[base.id];
    // FK join wins; exact filename next; fuzzy LAST (pre-linking fallback).
    let rawReadingListEntry: ReadingListEntry | undefined = caches.fkMap.get(base.id);
    if (!rawReadingListEntry && base.sourceFilename) {
      rawReadingListEntry = entries[base.sourceFilename];
    }
    if (!rawReadingListEntry && (base.title || base.author)) {
      const bookKey = generateMatchKey(base.title || '', base.author || '');
      if (bookKey) rawReadingListEntry = caches.matchMap.get(bookKey);
    }

    const prev = caches.resultCache.get(base.id);
    if (
      prev &&
      prev.base === base &&
      prev.rawBookProgress === rawBookProgress &&
      prev.rawReadingListEntry === rawReadingListEntry
    ) {
      nextCache.set(base.id, prev);
      return prev.result;
    }

    anyBookChanged = true;
    const bookProgress = resolveProgress(rawBookProgress, deviceId);
    const book: LibraryBook = {
      ...base,
      progress: bookProgress?.percentage || rawReadingListEntry?.percentage || 0,
      currentCfi: bookProgress?.currentCfi || undefined,
      lastRead: bookProgress?.lastRead || rawReadingListEntry?.lastUpdated || 0,
      allProgress: rawBookProgress,
      readingListEntry: rawReadingListEntry,
    };

    nextCache.set(base.id, { result: book, base, rawBookProgress, rawReadingListEntry });
    return book;
  });

  caches.lastPhase2 = { baseBooks: caches.baseBooks, progress: progressMap, entries };
  const lengthChanged = caches.resultCache.size !== nextCache.size;
  caches.resultCache = nextCache;

  // Preserve the output array reference when nothing changed.
  if (anyBookChanged || lengthChanged || phase1Changed) {
    useLibraryViewStore.setState({ books: result });
  }
}

let started = false;

/**
 * Start the input-store subscriptions (idempotent). Lazily invoked by the
 * first `useAllBooks()` render — no module-scope side effects (rule 8).
 */
export function ensureLibraryViewStarted(): void {
  if (started) return;
  started = true;
  recomputeLibraryView();
  useBookStore.subscribe(recomputeLibraryView);
  useLibraryStore.subscribe(recomputeLibraryView);
  useReadingStateStore.subscribe(recomputeLibraryView);
  useReadingListStore.subscribe(recomputeLibraryView);
}
