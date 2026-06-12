/**
 * useReaderController — the app-layer reader controller (Phase 6 §5,
 * prep/phase6-reader-engine.md PR-9: "route param → engine construction
 * (via an app/ controller)").
 *
 * Owns everything about the OPEN reader that is not presentation:
 *  - engine construction via useEpubReader (options assembly from
 *    preferences + book metadata, initial location, event callbacks),
 *  - the ReadingSessionRecorder lifecycle (Phase 6 §6),
 *  - the ReaderCommands object (Phase 6 §5a — the provider mounts it),
 *  - reader-wide lifecycle effects moved verbatim from the legacy
 *    ReaderView: version-check redirect, loading/error mirroring, audio +
 *    UI-store book context, popover/selection hygiene, unmount cleanup,
 *    TTS error toasts.
 *
 * The shell (src/components/reader/ReaderShell.tsx) is pure composition
 * over this controller's return surface.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useEpubReader, type EpubReaderOptions } from '@hooks/useEpubReader';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';
import { ReadingSessionRecorder } from '@domains/reader/session/ReadingSessionRecorder';
import type { ReaderCommands } from '@domains/reader/ui/ReaderCommands';
import { SearchSession, createWorkerSearchEngineFactory } from '@domains/search';
import { registerChineseReading, getBookBaseLanguage } from '@domains/chinese';
import type { PinyinPosition } from '@domains/chinese/types';
import type { BookMetadata } from '~types/db';
import type { DetailedSearchResult } from '~types/search';
import { searchTextRepo } from '@data/repos/searchText';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useToastStore } from '@store/useToastStore';
import { useBook } from '@store/libraryViewStore';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import { createSearchNavigator, type SearchNavigator } from '@app/reader/searchNavigation';
import { CURRENT_BOOK_VERSION } from '@lib/constants';
import { createLogger } from '@lib/logger';

const logger = createLogger('ReaderController');

const DEFAULT_CUSTOM_THEME = { bg: '#ffffff', fg: '#000000' };

export interface ReaderController {
  engine: ReaderEngine | null;
  isReady: boolean;
  areLocationsReady: boolean;
  bookMetadata: (BookMetadata & { coverBlob?: Blob }) | null;
  highlights: HighlightLayerManager | null;
  containerNode: Element | null;
  commands: ReaderCommands;
  pinyinPositions: PinyinPosition[];
  /** Bumps when a reading-history entry lands (ReadingHistoryPanel refresh). */
  historyTick: number;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  scrollWrapperRef: React.RefObject<HTMLDivElement | null>;
  readerViewMode: 'paginated' | 'scrolled';
  /**
   * The reader-session search surface (Phase 7 §F): one SearchSession per
   * open reader, worker-backed, fed by the persisted corpus. Replaces the
   * `searchClient` module singleton the controller used to terminate.
   */
  searchSession: SearchSession;
  /** Land on the EXACT occurrence with a temporary highlight (PR-S4). */
  navigateToSearchResult: (result: DetailedSearchResult) => Promise<void>;
}

export interface ReaderControllerDeps {
  /**
   * The import-jump gate (ImportJumpPrompt): returns true when the prompt
   * took over this relocation — progress saving is skipped (the legacy
   * "SKIP SAVING PROGRESS" branch).
   */
  checkImportJump: (percentage: number) => boolean;
}

export function useReaderController(
  bookId: string | undefined,
  deps: ReaderControllerDeps,
): ReaderController {
  const navigate = useNavigate();
  const viewerRef = useRef<HTMLDivElement>(null);
  const scrollWrapperRef = useRef<HTMLDivElement>(null);

  const {
    currentTheme,
    customTheme,
    fontFamily,
    lineHeight,
    fontSize,
    fontProfiles,
    shouldForceFont,
    readerViewMode,
    forceTraditionalChinese,
    showPinyin,
  } = usePreferencesStore(useShallow(state => ({
    currentTheme: state.currentTheme,
    customTheme: state.customTheme || DEFAULT_CUSTOM_THEME,
    fontFamily: state.fontFamily,
    lineHeight: state.lineHeight || 1.5,
    fontSize: state.fontSize,
    fontProfiles: state.fontProfiles || {},
    shouldForceFont: state.shouldForceFont,
    readerViewMode: state.readerViewMode || 'paginated',
    forceTraditionalChinese: state.forceTraditionalChinese,
    showPinyin: state.showPinyin,
  })));

  const {
    currentSectionTitle,
    setIsLoading,
    setCurrentSection,
    setCurrentBookId,
    resetUI,
    showPopover,
    hidePopover,
  } = useReaderUIStore(useShallow(state => ({
    currentSectionTitle: state.currentSectionTitle,
    setIsLoading: state.setIsLoading,
    setCurrentSection: state.setCurrentSection,
    setCurrentBookId: state.setCurrentBookId,
    resetUI: state.reset,
    showPopover: state.showPopover,
    hidePopover: state.hidePopover,
  })));

  // Panic-save context ref (recorder getContext — legacy panicSaveState).
  const panicSaveState = useRef({ readerViewMode, currentSectionTitle });
  useEffect(() => {
    panicSaveState.current = { readerViewMode, currentSectionTitle };
  }, [readerViewMode, currentSectionTitle]);

  // Select current book metadata from stores (Phase 2)
  const rawBookMetadata = useBook(bookId || null);
  const bookMetadata = useMemo(() => {
    if (!rawBookMetadata) return null;
    return {
      ...rawBookMetadata,
      coverBlob: rawBookMetadata.coverBlob || undefined, // Convert null to undefined for compatibility
    };
  }, [rawBookMetadata]);

  const [searchParams] = useSearchParams();
  const cfiOverride = searchParams.get('cfi');

  // Optimization: Read initial location once on mount/id change, avoiding subscription to progress updates
  const initialLocation = useMemo(() => {
    if (cfiOverride) return decodeURIComponent(cfiOverride);
    return bookId ? useReadingStateStore.getState().getProgress(bookId)?.currentCfi : undefined;
  }, [bookId, cfiOverride]);

  // Engine commands go through the TtsController facade (stable identities).
  const audio = useAudioCommands();

  const [historyTick, setHistoryTick] = useState(0);
  const [pinyinPositions, setPinyinPositions] = useState<PinyinPosition[]>([]);

  // Reading-session recording (Phase 6 §6): one recorder per book.
  const recorderRef = useRef<ReadingSessionRecorder | null>(null);

  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  // --- Setup useEpubReader Hook ---
  const readerOptions = useMemo<EpubReaderOptions>(() => ({
    viewMode: readerViewMode,
    currentTheme,
    customTheme,
    fontFamily,
    fontSize: (fontProfiles[(bookMetadata?.language || 'en').split('-')[0]] || {}).fontSize || fontSize,
    lineHeight: (fontProfiles[(bookMetadata?.language || 'en').split('-')[0]] || {}).lineHeight || lineHeight,
    shouldForceFont,
    initialLocation,
    metadata: bookMetadata,
    onLocationChange: (location, percentage, title, sectionId) => {
      // Initialize the recorder's previous-location tracker (legacy step 1
      // — it ran even when the import-jump check skipped the save).
      recorderRef.current?.prime(location, Date.now());

      // Import Jump Check (ImportJumpPrompt): true = prompt took over,
      // SKIP SAVING PROGRESS to avoid overwriting the imported progress.
      if (depsRef.current.checkImportJump(percentage)) {
        return;
      }

      // Reading-session recording (ReadingSessionRecorder, Phase 6 §6). A
      // false return is the recorder's no-op CFI guard — the legacy code
      // also skipped the section update in that case.
      const recorded = recorderRef.current?.onRelocated({
        location,
        percentage,
        title,
        viewMode: readerViewMode,
        at: Date.now(),
      });
      if (recorded === false) return;

      setCurrentSection(title, sectionId);
    },
    onTocLoaded: (newToc) => useReaderUIStore.getState().setToc(newToc),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onSelection: (cfiRange, range, _contents) => {
      try {
        // Pre-flight check: ensure range is valid and has dimensions
        if (!range || typeof range.getBoundingClientRect !== 'function') return;

        const rect = range.getBoundingClientRect();
        // If the selection has no width/height (e.g. collapsed or detached), skip
        if (rect.width === 0 && rect.height === 0) return;

        const iframe = viewerRef.current?.querySelector('iframe');
        if (iframe) {
          const iframeRect = iframe.getBoundingClientRect();
          showPopover(
            rect.left + iframeRect.left,
            rect.top + iframeRect.top,
            cfiRange,
            range.toString()
          );
        }
      } catch (e) {
        logger.warn('Selection measurement failed (likely DOM mutation)', e);
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onBookLoaded: (_book) => {
      // Indexing is now deferred until search is opened
    },
    onClick: (e: MouseEvent) => {
      const selection = e.view?.getSelection();
      if (!selection || selection.isCollapsed) {
        hidePopover();
        useReaderUIStore.getState().resetCompassState();
      }
    },
    onError: (msg) => {
      logger.error('Reader Error:', msg);
    },
  }), [
    readerViewMode,
    currentTheme,
    customTheme,
    fontFamily,
    fontSize,
    lineHeight,
    fontProfiles,
    shouldForceFont,
    bookId,
    showPopover,
    hidePopover,
    bookMetadata,
    initialLocation,
    setCurrentSection,
  ]);

  const {
    engine,
    isReady,
    areLocationsReady,
    isLoading: hookLoading,
    error: hookError,
  } = useEpubReader(bookId, viewerRef as React.RefObject<HTMLElement>, readerOptions);

  const engineRef = useRef(engine);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  // Reader-session search (Phase 7 §F, the post-merge reader adoption): ONE
  // SearchSession per open reader — worker lifecycle owned here (created
  // lazily on first index/search), corpus from the searchText repo, engine
  // crashes reset the session and surface a toast (search.md #6).
  const searchSessionRef = useRef<SearchSession | null>(null);
  if (!searchSessionRef.current) {
    searchSessionRef.current = new SearchSession({
      engineFactory: createWorkerSearchEngineFactory(),
      textSource: searchTextRepo,
      onError: (error) => {
        logger.error('Search engine failed; session reset', error);
        useToastStore.getState().showToast('Search failed', 'error');
      },
    });
  }
  const searchSession = searchSessionRef.current;

  const searchNavigatorRef = useRef<SearchNavigator | null>(null);
  if (!searchNavigatorRef.current) {
    searchNavigatorRef.current = createSearchNavigator(() => engineRef.current);
  }

  const navigateToSearchResult = useCallback(async (result: DetailedSearchResult) => {
    try {
      await searchNavigatorRef.current?.navigate(result);
    } catch (e) {
      logger.error('Search navigation failed', e);
    }
  }, []);

  // Chinese reading registration (Phase 6 §7, PR-10): the app layer wires
  // the feature module to the engine's content seam — and ONLY for books
  // whose BASE language is zh (getBookBaseLanguage is the CH-8 interim
  // helper; the legacy exact-match check skipped 'zh-CN'/'zh-TW' books).
  // Preference reads stay store-side here (domains-no-store): injected as a
  // thunk, read at run time. Preference CHANGES drive an explicit refresh —
  // the legacy React-deps re-run, made event-driven (CH-2).
  const bookLanguage = bookMetadata?.language;
  useEffect(() => {
    if (!engine || getBookBaseLanguage(bookLanguage) !== 'zh') {
      setPinyinPositions(prev => (prev.length === 0 ? prev : []));
      return;
    }
    const registration = registerChineseReading(engine, {
      getPrefs: () => {
        const prefs = usePreferencesStore.getState();
        return {
          forceTraditionalChinese: prefs.forceTraditionalChinese,
          showPinyin: prefs.showPinyin,
        };
      },
      onPositions: (positions) => setPinyinPositions(positions),
    });
    const unsubscribePrefs = usePreferencesStore.subscribe((state, prev) => {
      if (
        state.forceTraditionalChinese !== prev.forceTraditionalChinese ||
        state.showPinyin !== prev.showPinyin ||
        state.pinyinSize !== prev.pinyinSize
      ) {
        registration.refresh();
      }
    });
    return () => {
      unsubscribePrefs();
      registration.dispose();
      setPinyinPositions(prev => (prev.length === 0 ? prev : []));
    };
  }, [engine, bookLanguage]);

  // Check version and redirect if outdated
  useEffect(() => {
    if (bookMetadata) {
      const effectiveVersion = bookMetadata.version ?? 0;
      if (effectiveVersion < CURRENT_BOOK_VERSION && bookId) {
        navigate('/', { state: { reprocessBookId: bookId } });
      }
    }
  }, [bookMetadata, bookId, navigate]);

  // Reading-session recorder lifecycle (Phase 6 §6): one per book.
  // flushSync on teardown is the legacy unmount panic save.
  useEffect(() => {
    if (!bookId) return;
    const recorder = new ReadingSessionRecorder({
      bookId,
      getResolver: () => engineRef.current,
      store: {
        getCurrentCfi: () =>
          useReadingStateStore.getState().getProgress(bookId)?.currentCfi,
        updateReadingSession: (id, cfi, pct, updates) =>
          useReadingStateStore.getState().updateReadingSession(id, cfi, pct, updates),
        addCompletedRange: (id, range, type, label) =>
          useReadingStateStore.getState().addCompletedRange(id, range, type, label),
      },
      getContext: () => ({
        title: panicSaveState.current.currentSectionTitle,
        viewMode: panicSaveState.current.readerViewMode,
      }),
      onHistoryRecorded: () => setHistoryTick(t => t + 1),
    });
    recorderRef.current = recorder;
    return () => {
      recorder.flushSync();
      recorder.dispose();
      recorderRef.current = null;
    };
  }, [bookId]);

  // Sync loading state
  useEffect(() => {
    setIsLoading(hookLoading);
  }, [hookLoading, setIsLoading]);

  // Handle errors
  useEffect(() => {
    if (hookError) {
      useToastStore.getState().showToast(hookError, 'error');
      if (hookError === 'Book file not found') {
        navigate('/');
      }
    }
  }, [hookError, navigate]);

  // Set Book ID and Audio Service context
  useEffect(() => {
    if (bookId) {
      audio.setBookId(bookId);
      setCurrentBookId(bookId);
    }
  }, [bookId, setCurrentBookId, audio]);

  // Hide selection popover when Chinese reading settings change.
  // This prevents "orphaned" popovers that point to nodes we are about to replace in DOM.
  useEffect(() => {
    hidePopover();
  }, [forceTraditionalChinese, showPinyin, hidePopover]);

  // Handle Unmount Cleanup
  const reset = useCallback(() => {
    resetUI();
    // Do NOT reset reading state (progress), as that wipes user data!
  }, [resetUI]);
  useEffect(() => {
    return () => {
      searchNavigatorRef.current?.dispose();
      searchSessionRef.current?.dispose();
      setCurrentBookId(null);
      reset();
      hidePopover();
      setPinyinPositions(prev => prev.length === 0 ? prev : []);
    };
  }, [reset, hidePopover, setCurrentBookId]);

  // Clear selection when popover is hidden
  const popoverVisible = useReaderUIStore(state => state.popover.visible);
  useEffect(() => {
    if (!popoverVisible) {
      engineRef.current?.clearSelection();
    }
  }, [popoverVisible]);

  // Handle TTS Errors
  const lastError = useTTSPlaybackStore(state => state.lastError);
  const clearError = useTTSPlaybackStore(state => state.clearError);
  useEffect(() => {
    if (lastError) {
      useToastStore.getState().showToast(lastError, 'error');
      clearError(); // Clear immediately so it doesn't persist in TTS store
    }
  }, [lastError, clearError]);

  // --- ReaderCommands (Phase 6 §5a) ---

  const handlePlayFromSelection = useCallback((cfiRange: string) => {
    // The queue is engine state replicated into the store via the engine subscription.
    const queue = useTTSPlaybackStore.getState().queue;
    const currentEngine = engineRef.current;
    if (!queue || queue.length === 0 || !currentEngine) return;

    try {
      // Get range for selection (sync, rendered-content range — the
      // queue covers the displayed section)
      const selectionRange = currentEngine.getRenderedRange(cfiRange);
      if (!selectionRange) return;

      let bestIndex = -1;
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (!item.cfi) continue;

        // Get range for item
        const itemRange = currentEngine.getRenderedRange(item.cfi);
        if (!itemRange) continue;

        // Compare start points
        const comparison = itemRange.compareBoundaryPoints(Range.START_TO_START, selectionRange);

        if (comparison <= 0) {
          bestIndex = i;
        } else {
          // Found an item that starts after the selection.
          // The previous item (bestIndex) is the one we want.
          break;
        }
      }

      if (bestIndex !== -1) {
        audio.jumpTo(bestIndex);
      }
    } catch (e) {
      logger.error('Error matching CFI for playback', e);
    }
  }, [audio]);

  const commands = useMemo<ReaderCommands>(() => ({
    jumpTo: (cfi) => {
      try {
        engineRef.current?.display(cfi);
      } catch (e) {
        logger.error('Failed to jump to location', e);
      }
    },
    nextPage: () => { engineRef.current?.next(); },
    prevPage: () => { engineRef.current?.prev(); },
    nextChapter: () => {
      // TTS-aware routing (the old reader:chapter-nav listener body).
      const { status } = useTTSPlaybackStore.getState();
      if (status !== 'stopped') {
        audio.skipToNextSection();
      } else {
        engineRef.current?.next();
      }
    },
    prevChapter: () => {
      const { status } = useTTSPlaybackStore.getState();
      if (status !== 'stopped') {
        audio.skipToPreviousSection();
      } else {
        engineRef.current?.prev();
      }
    },
    playFromSelection: (cfiRange) => handlePlayFromSelection(cfiRange),
    refineSelection: () => {
      // D11: the audio-triage selection refinement, reachable again (it
      // rode a rendition prop that was never supplied). Reads the current
      // iframe selection through the engine port.
      const currentEngine = engineRef.current;
      if (!currentEngine) return null;
      try {
        const view = currentEngine.getContentViews()[0];
        const selection = view?.window.getSelection();
        if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
          const cfiRange = view.cfiFromRange(selection.getRangeAt(0));
          const text = selection.toString();
          selection.removeAllRanges();
          if (cfiRange) return { cfiRange, text };
        }
      } catch {
        // Selection extraction failed; the caller keeps its original data
      }
      return null;
    },
  }), [audio, handlePlayFromSelection]);

  return {
    engine,
    isReady,
    areLocationsReady,
    bookMetadata,
    // The ONE epub.js annotations caller (Phase 6 §4): every highlight
    // layer goes through the engine's manager.
    highlights: engine?.highlights ?? null,
    containerNode: engine?.getOverlayContainer() ?? null,
    commands,
    pinyinPositions,
    historyTick,
    viewerRef,
    scrollWrapperRef,
    readerViewMode,
    searchSession,
    navigateToSearchResult,
  };
}
