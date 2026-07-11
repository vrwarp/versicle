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
import { SearchSession, createWorkerSearchEngineFactory, EmbeddingIndexer } from '@domains/search';
import { getEmbeddingClient, type EmbeddingClient } from '@domains/google';
import { getArtifactConsult } from '@app/google/artifactConsult';
import { registerChineseReading, getBookBaseLanguage } from '@domains/chinese';
import type { PinyinPosition } from '@domains/chinese/types';
import type { BookMetadata } from '~types/book';
import type { DetailedSearchResult } from '~types/search';
import { searchTextRepo } from '@data/repos/searchText';
import { embeddingsRepo } from '@data/repos/embeddings';
import { SearchEngine } from '@lib/search-engine';
import { useGenAIStore } from '@store/useGenAIStore';
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

/**
 * Drop out of audio-follow mode on a manual page turn during playback (the
 * paginated counterpart to the scrolled-mode wheel/touch signal). No-op when
 * audio is idle or already not following, so plain reading never churns the
 * store. Chapter skips (next/prevChapter) deliberately KEEP following — the
 * user asked the audio to move, so the page should move with it.
 */
function breakAudioFollowOnManualNav() {
  if (useTTSPlaybackStore.getState().status === 'stopped') return;
  const ui = useReaderUIStore.getState();
  if (ui.followingAudio) ui.setFollowingAudio(false);
}

// The int8 quantizer (SearchEngine.quantizeInt8PerVector) for the foreground
// embedding indexer — a pure compute helper, instantiated once and passed in as
// a port so the search domain never deep-imports the worker. The instance holds
// no per-book state for quantization.
const embeddingQuantizer = new SearchEngine();

// How long to wait before retrying a failed foreground embedding pass: 90 s —
// long enough for a minute-window rate limit to clear, short enough that the
// book finishes indexing during a normal reading session.
const EMBEDDING_RETRY_DELAY_MS = 90_000;

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
  const locationOverride = searchParams.get('location');
  const deepOffset = searchParams.get('offset');
  const deepLength = searchParams.get('length');

  // Optimization: Read initial location once on mount/id change, avoiding subscription to progress updates
  const initialLocation = useMemo(() => {
    if (cfiOverride) return decodeURIComponent(cfiOverride);
    if (locationOverride) return decodeURIComponent(locationOverride);
    return bookId ? useReadingStateStore.getState().getProgress(bookId)?.currentCfi : undefined;
  }, [bookId, cfiOverride, locationOverride]);

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
    onSelection: (cfiRange, range, _contents) => {
      // Audio-bookmark triage OWNS the live selection: it programmatically
      // selects the bookmarked block (engine.selectRange → selectionchange,
      // which now drives the selection bridge) and the user may refine that
      // selection by hand before confirming. Neither is a "new annotation"
      // gesture, so it must NOT reset the audio-triage pill into the annotation
      // toolbar. (compassState is set synchronously right after selectRange, so
      // it is already 'audio-triage' by the time the debounced emit lands.)
      if (useReaderUIStore.getState().compassState?.variant === 'audio-triage') return;
      try {
        // Show the compass on the SELECTION itself, not on its geometry. The
        // annotation pill is fixed-position (ReaderControlBar `bottom-8`), so
        // the x/y below are not load-bearing — we must NOT gate the popover on
        // a non-zero bounding rect. On Android a perfectly valid selection can
        // report a degenerate rect (column-break / off-screen / not-yet-laid-
        // out range), and the old `rect.width===0 && height===0` early-return
        // silently dropped it. Gate only on there being real selected text.
        const text = range?.toString() ?? '';
        if (!cfiRange || !text.trim()) return;

        // Best-effort screen coordinates (kept for any future anchored UI).
        let x = 0;
        let y = 0;
        try {
          const rect = range?.getBoundingClientRect?.();
          const iframe = viewerRef.current?.querySelector('iframe');
          const iframeRect = iframe?.getBoundingClientRect();
          if (rect && iframeRect) {
            x = rect.left + iframeRect.left;
            y = rect.top + iframeRect.top;
          }
        } catch {
          // Coordinates are best-effort; never block the popover on them.
        }

        // A fresh user selection must start from a clean compass: clear any
        // lingering compassState (a prior vocab-triage / audio-triage / an
        // existing-highlight tap that set targetAnnotation). The
        // ReaderControlBar dispatcher ranks compassState.variant ABOVE
        // popover.visible, so a stale variant would otherwise mask the new
        // selection's annotation toolbar — "highlighting no longer triggers
        // the compass". (The onClick collapse path resets it the same way.)
        useReaderUIStore.getState().resetCompassState();
        showPopover(x, y, cfiRange, text);
      } catch (e) {
        logger.warn('Selection handling failed', e);
      }
    },
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
    // Foreground document-embedding indexer: ports wired from the lazy embedding
    // client facade + the searchText/embeddings repos + the int8 quantizer.
    // bookId/CFI flow as arguments through enqueueEmbedding, so the search domain
    // never reaches into a store.
    const embeddingClient: EmbeddingClient = getEmbeddingClient();
    const embeddingIndexer = new EmbeddingIndexer({
      embeddingClient,
      textSource: searchTextRepo,
      embeddingsRepo,
      quantize: (vec) => embeddingQuantizer.quantizeInt8PerVector(vec),
      getConfig: () => {
        const s = useGenAIStore.getState();
        return { model: s.embeddingModel, dims: s.embeddingDims };
      },
      // Before spending Gemini quota to embed this book on reader-open, check
      // whether another of the user's devices already uploaded its embeddings to
      // the user's own cloud, and if so download them instead. interactive: true
      // marks the reader-open as the user gesture that authorizes the cloud read.
      // When sync/Google is not composed, the probe resolves false and we fall
      // back to embedding locally, so the no-sync reader path is unchanged.
      consult: {
        probe: (bookId) =>
          getArtifactConsult()?.probeArtifact(bookId, { interactive: true }) ??
          Promise.resolve(false),
        hydrate: async (bookId) => {
          const row = await getArtifactConsult()?.hydrateFromArtifact(bookId, {
            interactive: true,
          });
          return row != null;
        },
      },
    });
    searchSessionRef.current = new SearchSession({
      engineFactory: createWorkerSearchEngineFactory(),
      textSource: searchTextRepo,
      embeddingIndexer,
      // Ports for semantic (meaning-based) search queries; plain text/regex
      // search stays the default. Reuse the SAME embedding client + repo +
      // quantizer the indexer was wired from; the semantic on/off flag and
      // {model,dims} arrive via the injected thunk reading the GenAI store
      // (mirrors the getConfig thunk above), so the search domain reaches no
      // store directly.
      embeddingClient,
      embeddingsSource: embeddingsRepo,
      quantize: (vec) => embeddingQuantizer.quantizeInt8PerVector(vec),
      getSemanticConfig: () => {
        const s = useGenAIStore.getState();
        return { enabled: s.isEnabled, model: s.embeddingModel, dims: s.embeddingDims };
      },
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

  // Once the reader is open, embed the book's text OUTWARD from the current
  // reading position so semantic search covers what the user is reading first.
  // The trigger is reader-open per bookId: the CFI is captured at RUN time, so
  // the section title is NOT a dependency — re-running on every section change
  // would only re-walk the resume-skip over already-embedded sections. The
  // indexer no-ops when the embedding client is unconfigured. bookId/CFI are
  // passed as arguments, so the trigger context stays here in app/, never in the
  // search domain. A failed pass (e.g. rate-limit backpressure mid-book) is
  // retried 90 s later while the reader stays open — the per-section
  // resume-skip makes each retry pick up where the last pass stopped.
  useEffect(() => {
    if (!isReady || !bookId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      const currentCfi = useReadingStateStore.getState().getProgress(bookId)?.currentCfi;
      void searchSession.enqueueEmbedding(bookId, currentCfi).catch((e) => {
        logger.error('Embedding indexer failed; retrying in 90s', e);
        if (!cancelled) retryTimer = setTimeout(attempt, EMBEDDING_RETRY_DELAY_MS);
      });
    };
    attempt();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [isReady, bookId, searchSession]);

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
        const engine = engineRef.current;
        if (!engine) return;
        void engine.display(cfi)
          .then(() => {
            requestAnimationFrame(() => {
              void engineRef.current?.display(cfi).catch(() => {});
            });
          })
          .catch((e) => {
            logger.error('Failed to jump to location', e);
          });
      } catch (e) {
        logger.error('Failed to jump to location', e);
      }
    },
    nextPage: () => { breakAudioFollowOnManualNav(); engineRef.current?.next(); },
    prevPage: () => { breakAudioFollowOnManualNav(); engineRef.current?.prev(); },
    nextChapter: () => {
      // Pure audio transport (compass-pill rework Phase 1): the pill arrows
      // skip a TTS section while audio is live and are inert otherwise. The
      // pill disables them when stopped; this guard also makes the command a
      // no-op for any out-of-band caller so it can never auto-start playback.
      // Page turns no longer route through here — they moved to the reading
      // surface (PageTurnRails + the ArrowLeft/Right shortcuts), so the arrows
      // have ONE meaning ("skip chapter") instead of flipping with TTS state.
      if (useTTSPlaybackStore.getState().status !== 'stopped') {
        audio.skipToNextSection();
      }
    },
    prevChapter: () => {
      if (useTTSPlaybackStore.getState().status !== 'stopped') {
        audio.skipToPreviousSection();
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

  // Navigate to deep-linked semantic search hit once ready
  useEffect(() => {
    if (!isReady || !locationOverride || !deepOffset || !deepLength) return;

    const result: DetailedSearchResult = {
      href: decodeURIComponent(locationOverride),
      charOffset: Number(deepOffset),
      matchLength: Number(deepLength),
      occurrence: 1,
      excerpt: '',
    };

    navigateToSearchResult(result);

    // Clear search parameters from query to avoid re-triggering highlight on reload
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('location');
    newParams.delete('offset');
    newParams.delete('length');
    navigate({ search: newParams.toString() }, { replace: true });
  }, [isReady, locationOverride, deepOffset, deepLength, navigateToSearchResult, searchParams, navigate]);

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
