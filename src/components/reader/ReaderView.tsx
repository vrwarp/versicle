import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { NavigationItem } from '~types/db';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useBookStore } from '@store/useBookStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useBook } from '@store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useUIStore } from '@store/useUIStore';
import { useTTS } from '@hooks/useTTS';
import { useEpubReader, type EpubReaderOptions } from '@hooks/useEpubReader';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { findTocItem } from '@lib/reader/titleResolver';
import { AnnotationList } from './AnnotationList';
import { LexiconManager } from './LexiconManager';
import { VisualSettings } from './VisualSettings';
import { useToastStore } from '@store/useToastStore';
import { Popover, PopoverTrigger } from '../ui/Popover';
import { Sheet, SheetTrigger } from '../ui/Sheet';
import { UnifiedAudioPanel } from './UnifiedAudioPanel';
import { contentAnalysisRepository } from '@app/repositories/ContentAnalysisRepository';
import { searchClient } from '@lib/search';
import { SyncStatusPanel } from './SyncStatusPanel';
import { List, Settings, ArrowLeft, X, Search, Highlighter, Maximize, Minimize, Type, Headphones, Monitor } from 'lucide-react';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import { ReaderTTSController } from './ReaderTTSController';
import { generateCfiRange, snapCfiToSentence } from '@kernel/cfi';
import { TOCPanel, SearchPanel } from './panels';
import { Button } from '../ui/Button';
import { useSmartTOC } from '@hooks/useSmartTOC';

import { cn } from '@lib/utils';
import { Dialog } from '../ui/Dialog';
import { useSidebarState } from '@hooks/useSidebarState';
import { useGenAIStore } from '@store/useGenAIStore';
import { ContentAnalysisLegend } from './ContentAnalysisLegend';
import { TYPE_COLORS } from '~types/content-analysis';
import { CURRENT_BOOK_VERSION } from '@lib/constants';
import { createLogger } from '@lib/logger';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { HistoryHighlighter } from './HistoryHighlighter';
import { PinyinOverlay, type PinyinPosition } from './PinyinOverlay';
import { useCfiCoordinates } from '@hooks/useCfiCoordinates';
import { AnnotationMarkerOverlay } from './AnnotationMarkerOverlay';
import { useReaderNavigation } from '@hooks/useReaderNavigation';
import { ReaderHighlightsStyles } from './ReaderHighlightsStyles';
import {
    annotationClassName,
    AUDIO_BOOKMARK_PENDING_CLASS,
} from '@domains/reader/engine/highlightStyles';

const logger = createLogger('ReaderView');

/**
 * The main reader interface component.
 * Renders the EPUB content using epub.js and provides controls for navigation,
 * settings, Text-to-Speech (TTS), and search.
 *
 * @returns A React component for reading books.
 */
const DEFAULT_CUSTOM_THEME = { bg: '#ffffff', fg: '#000000' };

export const ReaderView: React.FC = () => {
    const { id: bookId } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { activeSidebar, setSidebar } = useSidebarState();
    const viewerRef = useRef<HTMLDivElement>(null);

    const previousLocation = useRef<{ start: string; end: string; timestamp: number } | null>(null);
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
        pinyinSize
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
        pinyinSize: state.pinyinSize
    })));

    const {
        toc,
        setToc,
        setIsLoading,
        currentSectionTitle,
        currentSectionId,
        immersiveMode,
        setImmersiveMode,
        setPlayFromSelection,
        setCurrentSection,
        setCurrentBookId,
        resetCompassState,
        resetUI,
        showPopover,
        hidePopover
    } = useReaderUIStore(useShallow(state => ({
        toc: state.toc,
        setToc: state.setToc,
        setIsLoading: state.setIsLoading,
        currentSectionTitle: state.currentSectionTitle,
        currentSectionId: state.currentSectionId,
        immersiveMode: state.immersiveMode,
        setImmersiveMode: state.setImmersiveMode,
        setPlayFromSelection: state.setPlayFromSelection,
        setJumpToLocation: state.setJumpToLocation,
        setCurrentSection: state.setCurrentSection,
        setCurrentBookId: state.setCurrentBookId,
        resetCompassState: state.resetCompassState,
        resetUI: state.reset,
        showPopover: state.showPopover,
        hidePopover: state.hidePopover
    })));

    logger.debug(`viewMode: ${readerViewMode}, immersive: ${immersiveMode}`);

    useEffect(() => {
        if (activeSidebar !== 'none' || immersiveMode) {
            resetCompassState();
        }
    }, [activeSidebar, immersiveMode, resetCompassState]);

    const panicSaveState = useRef({ readerViewMode, currentSectionTitle });

    useEffect(() => {
        panicSaveState.current = { readerViewMode, currentSectionTitle };
    }, [readerViewMode, currentSectionTitle]);

    // Select current book metadata and progress from stores (Phase 2)
    const rawBookMetadata = useBook(bookId || null);
    const bookMetadata = useMemo(() => {
        if (!rawBookMetadata) return null;
        return {
            ...rawBookMetadata,
            coverBlob: rawBookMetadata.coverBlob || undefined // Convert null to undefined for compatibility
        };
    }, [rawBookMetadata]);

    const [searchParams] = useSearchParams();
    const cfiOverride = searchParams.get('cfi');

    // Optimization: Read initial location once on mount/id change, avoiding subscription to progress updates
    const initialLocation = useMemo(() => {
        if (cfiOverride) return decodeURIComponent(cfiOverride);
        return bookId ? useReadingStateStore.getState().getProgress(bookId)?.currentCfi : undefined;
    }, [bookId, cfiOverride]);

    const reset = useCallback(() => {
        resetUI();
        // Do NOT reset reading state (progress), as that wipes user data!
    }, [resetUI]);

    // Engine commands go through the TtsController facade (stable identities).
    const audio = useAudioCommands();

    // Optimization: Select only necessary state to prevent re-renders on every activeCfi/currentIndex change
    const isPlaying = useTTSPlaybackStore(state => state.isPlaying);
    const lastError = useTTSPlaybackStore(state => state.lastError);
    const clearError = useTTSPlaybackStore(state => state.clearError);
    const isDebugModeEnabled = useGenAIStore(state => state.isDebugModeEnabled);

    const loadAnnotations = useAnnotationStore(state => state.loadAnnotations);

    // BOLT OPTIMIZATION: Fine-grained selector for annotations
    // Only re-render when annotations for THIS specific book change, not when any annotation in the library changes.
    const annotationList = useAnnotationStore(useShallow(state => {
        const list = [];
        for (const key in state.annotations) {
            if (Object.prototype.hasOwnProperty.call(state.annotations, key)) {
                if (state.annotations[key].bookId === bookId) {
                    list.push(state.annotations[key]);
                }
            }
        }
        return list;
    }));


    const [historyTick, setHistoryTick] = useState(0);
    const [pinyinPositions, setPinyinPositions] = useState<PinyinPosition[]>([]);

    // --- Import Progress Jump Logic ---
    const [showImportJumpDialog, setShowImportJumpDialog] = useState(false);
    // Tracks if we are waiting for the engine to finish generating locations to perform a jump
    const [isWaitingForJump, setIsWaitingForJump] = useState(false);
    const [importJumpTarget, setImportJumpTarget] = useState(0);
    const hasPromptedForImport = useRef(false);
    const metadataRef = useRef(null as unknown); // Will hold metadata

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
            // Initialize previousLocation if it's null (e.g. initial load), so we can track subsequent moves
            if (!previousLocation.current) {
                previousLocation.current = {
                    start: location.startCfi,
                    end: location.endCfi,
                    timestamp: Date.now()
                };
            }

            // Import Jump Check
            // If we have metadata, no saved CFI (never opened), but have progress (from import), and haven't prompted yet.
            // And current position is effectively start.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const meta = metadataRef.current as any;
            if (meta && !meta.currentCfi && meta.progress > 0 && !hasPromptedForImport.current && bookId) {
                // We only trigger if we are at the start (percentage ~0)
                if (percentage < 0.01) {
                    setImportJumpTarget(meta.progress);
                    setShowImportJumpDialog(true);
                    hasPromptedForImport.current = true;
                    // SKIP SAVING PROGRESS this time to avoid overwriting the imported progress with 0
                    return;
                }
            }
            hasPromptedForImport.current = true; // Ensure we only check once per session

            // Prevent infinite loop if CFI hasn't changed (handled in store usually, but double check)
            const currentProgress = useReadingStateStore.getState().getProgress(bookId || '');
            if (location.startCfi === (currentProgress?.currentCfi || '')) return;

            // Reading History Calculation
            // We use a promise to handle the potential async nature of snapCfiToSentence for the PREVIOUS range,
            // while bundling it with the synchronous update for the CURRENT range.
            const prepareUpdates = async () => {
                if (!bookId) return;

                const updates: import('@store/useReadingStateStore').SessionUpdate[] = [];

                // 1. Calculate Previous Range (Async)
                if (previousLocation.current) {
                    const prevStart = previousLocation.current.start;
                    const prevEnd = previousLocation.current.end;
                    const duration = Date.now() - previousLocation.current.timestamp;
                    const isScroll = readerViewMode === 'scrolled';
                    const shouldSave = isScroll ? duration > 2000 : true;

                    if (prevStart && prevEnd && prevStart !== location.startCfi && shouldSave) {
                        const currentEngine = engineRef.current;
                        // Capture title synchronously before async op to avoid race condition with setCurrentSection
                        const previousSectionTitle = panicSaveState.current.currentSectionTitle;

                        if (currentEngine) {
                            try {
                                // Engine = kernel CfiRangeResolver; the OPF
                                // language keeps snapping locale-aware
                                // (identical to the old Book-based path).
                                const language = currentEngine.getLanguage();
                                const [snappedStart, snappedEnd] = await Promise.all([
                                    snapCfiToSentence(currentEngine, prevStart, language),
                                    snapCfiToSentence(currentEngine, prevEnd, language)
                                ]);

                                const range = generateCfiRange(snappedStart, snappedEnd);
                                const type = isScroll ? 'scroll' : 'page';
                                const label = previousSectionTitle || undefined;

                                // Ignore generic "Chapter" placeholder
                                if (label !== 'Chapter') {
                                    updates.push({ range, type, label });
                                    setHistoryTick(t => t + 1);
                                }
                            } catch (err) {
                                logger.error("History processing failed", err);
                                // Continue even if history fails, to save current location
                            }
                        }
                    }
                }

                // 2. Calculate Current Range (Sync)
                // Ensure current segment is in history so it appears at top of list
                const currentRange = generateCfiRange(location.startCfi, location.endCfi);
                const currentType = readerViewMode === 'scrolled' ? 'scroll' : 'page';
                updates.push({ range: currentRange, type: currentType, label: title });

                // 3. Single Atomic Update
                useReadingStateStore.getState().updateReadingSession(
                    bookId,
                    location.startCfi,
                    percentage,
                    updates
                );
            };

            // Execute the updates
            prepareUpdates().catch(err => {
                logger.error("Failed to update reading session", err);
            });

            // Update refs immediately (independent of store storage)
            previousLocation.current = {
                start: location.startCfi,
                end: location.endCfi,
                timestamp: Date.now()
            };
            setCurrentSection(title, sectionId);
        },
        onTocLoaded: (newToc) => setToc(newToc),
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
                logger.warn("Selection measurement failed (likely DOM mutation)", e);
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
            logger.error("Reader Error:", msg);
        },
        onPinyinPositionsUpdate: (positions) => {
            setPinyinPositions(positions);
        }
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
        // updateLocation,
        setToc,
        showPopover,
        hidePopover,
        bookMetadata,
        initialLocation,
        setCurrentSection
    ]);

    const {
        engine,
        book,
        isReady: isRenditionReady,
        areLocationsReady,
        isLoading: hookLoading,
        error: hookError
    } = useEpubReader(bookId, viewerRef as React.RefObject<HTMLElement>, readerOptions);

    // Filter annotations that have notes for overlay rendering
    const noteAnnotations = useMemo(() =>
        annotationList.filter(a => !!a.note),
        [annotationList]
    );

    const noteCfis = useMemo(() =>
        noteAnnotations.map(a => a.cfiRange),
        [noteAnnotations]
    );

    // Calculate coordinates for note markers (engine geometry primitive)
    const markerCoords = useCfiCoordinates(engine, noteCfis, [fontSize, readerViewMode]);

    // Merge coordinates with annotation metadata
    const markers = useMemo(() => {
        return markerCoords.map(coord => {
            const annotation = noteAnnotations.find(a => a.cfiRange === coord.cfi);
            return {
                id: annotation?.id || '',
                cfi: coord.cfi,
                top: coord.top,
                left: coord.left,
                note: annotation?.note || '',
                text: annotation?.text || ''
            };
        });
    }, [markerCoords, noteAnnotations]);

    const containerNode = engine?.getOverlayContainer() ?? null;

    // The ONE epub.js annotations caller (Phase 6 §4): every highlight layer
    // (annotation/tts/history/debug) goes through the engine's manager.
    const highlights = engine?.highlights ?? null;

    useEffect(() => {
        metadataRef.current = bookMetadata;

        // Check version and redirect if outdated
        if (bookMetadata) {
            const effectiveVersion = bookMetadata.version ?? 0;
            if (effectiveVersion < CURRENT_BOOK_VERSION && bookId) {
                navigate('/', { state: { reprocessBookId: bookId } });
            }
        }
    }, [bookMetadata, bookId, navigate]);

    const engineRef = useRef(engine);
    useEffect(() => {
        engineRef.current = engine;
    }, [engine]);

    // Sync loading state
    useEffect(() => {
        setIsLoading(hookLoading);
    }, [hookLoading, setIsLoading]);

    // Register jumpToLocation
    const { setJumpToLocation } = useReaderUIStore(useShallow(state => ({
        setJumpToLocation: state.setJumpToLocation
    })));

    useEffect(() => {
        if (setJumpToLocation && engine) {
            setJumpToLocation((cfi) => {
                try {
                    engine.display(cfi);
                } catch (e) {
                    logger.error("Failed to jump to location", e);
                }
            });
            // Cleanup provided in store reset, effectively replacement overrides previous
        }
    }, [setJumpToLocation, engine]);

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

    // Save reading history on unmount
    useEffect(() => {
        return () => {
            if (bookId && previousLocation.current) {
                const prevStart = previousLocation.current.start;
                const prevEnd = previousLocation.current.end;
                const duration = Date.now() - previousLocation.current.timestamp;

                // Only save if duration > 2s (avoid strict mode double-mounts and accidental nav)
                if (prevStart && prevEnd && duration > 2000) {
                    // Panic Save: Synchronous, raw capture.
                    // We bypass snapCfiToSentence to avoid async calls on the Book instance,
                    // which might be destroyed during unmount, causing crashes.
                    // This ensures reading history is saved even if the reader is tearing down.
                    const range = generateCfiRange(prevStart, prevEnd);
                    const { readerViewMode: mode, currentSectionTitle: title } = panicSaveState.current;
                    const type = mode === 'scrolled' ? 'scroll' : 'page';
                    const label = title || undefined;

                    // Ignore generic "Chapter" placeholder
                    if (label !== 'Chapter') {
                        try {
                            useReadingStateStore.getState().addCompletedRange(bookId, range, type, label);
                        } catch (e) {
                            logger.error("History panic save failed", e);
                        }
                    }
                }
            }
        };
    }, [bookId]);

    // Handle Unmount Cleanup
    useEffect(() => {
        return () => {
            searchClient.terminate();
            setCurrentBookId(null);
            reset();
            hidePopover();
            setPinyinPositions(prev => prev.length === 0 ? prev : []);
        };
    }, [reset, hidePopover, setCurrentBookId]);

    const handleClearSelection = useCallback(() => {
        engineRef.current?.clearSelection();
    }, []);

    // Clear selection when popover is hidden
    const popoverVisible = useReaderUIStore(state => state.popover.visible);
    useEffect(() => {
        if (!popoverVisible) {
            handleClearSelection();
        }
    }, [popoverVisible, handleClearSelection]);


    // Use TTS Hook
    useTTS();

    // Note: TTS Highlighting and Keyboard navigation logic moved to ReaderTTSController
    // to prevent unnecessary re-renders of the main ReaderView.

    // Load Annotations from DB
    useEffect(() => {
        if (bookId) {
            loadAnnotations(bookId);
        }
    }, [bookId, loadAnnotations]);

    const handleJumpConfirm = async () => {
        if (areLocationsReady) {
            setShowImportJumpDialog(false);
            if (engine) {
                try {
                    const cfi = engine.locations.cfiFromPercentage(importJumpTarget);
                    if (cfi) {
                        await engine.display(cfi);
                        // dbService.saveProgress will be called by the subsequent onLocationChange
                    }
                } catch (e) {
                    logger.error("Jump failed", e);
                    useToastStore.getState().showToast('Failed to jump to location', 'error');
                }
            }
        } else {
            // Keep dialog open but change UI to loading
            setIsWaitingForJump(true);
        }
    };

    const handleJumpCancel = () => {
        setShowImportJumpDialog(false);
        setIsWaitingForJump(false);
        // Explicitly save current position (0) to mark as "started"
        if (bookId) {
            const currentProgress = useReadingStateStore.getState().getProgress(bookId);
            const currentCfi = currentProgress?.currentCfi;
            // updateLocation handles saving to Yjs
            if (currentCfi) {
                useReadingStateStore.getState().updateLocation(bookId, currentCfi, currentProgress?.percentage || 0);
            }
        }
    };

    // Watch for locations to become ready if waiting
    useEffect(() => {
        // If we are waiting, and the capability arrives...
        if (isWaitingForJump && areLocationsReady && engine) {
            try {
                const cfi = engine.locations.cfiFromPercentage(importJumpTarget);
                if (cfi) {
                    engine.display(cfi);
                    setIsWaitingForJump(false);
                    setShowImportJumpDialog(false);
                }
            } catch (e) {
                logger.error("Deferred jump failed", e);
                useToastStore.getState().showToast('Failed to jump to location', 'error');
                setIsWaitingForJump(false);
                setShowImportJumpDialog(false);
            }
        }
    }, [isWaitingForJump, areLocationsReady, engine, importJumpTarget]);

    // Timeout safety for jump wait
    useEffect(() => {
        let timeout: NodeJS.Timeout;
        if (isWaitingForJump) {
            timeout = setTimeout(() => {
                setIsWaitingForJump(false);
                setShowImportJumpDialog(false);
                useToastStore.getState().showToast("Could not calculate location. Starting from beginning.", "error");
            }, 120000); // 2 minutes timeout
        }
        return () => clearTimeout(timeout);
    }, [isWaitingForJump]);

    // Apply Annotations to Rendition
    // Map of ID -> CFI for highlights
    const addedAnnotations = useRef<Map<string, string>>(new Map());

    // Clear tracked annotations if the engine changes (e.g. re-initialization)
    useEffect(() => {
        addedAnnotations.current.clear();
    }, [engine]);



    useEffect(() => {
        if (engine && highlights && isRenditionReady) {
            const currentIds = new Set(annotationList.map(a => a.id));

            // 1. Remove deleted annotations (Highlights only - markers are now in React overlay)
            addedAnnotations.current.forEach((cfi, id) => {
                if (!currentIds.has(id)) {
                    highlights.remove('annotation', cfi);
                    addedAnnotations.current.delete(id);
                }
            });

            // 2. Add new annotations
            annotationList.forEach(annotation => {
                // Add Highlight/Underline if missing
                if (!addedAnnotations.current.has(annotation.id)) {
                    if (annotation.type === 'audio-bookmark') {
                        highlights.add('annotation', annotation.cfiRange, {
                            className: AUDIO_BOOKMARK_PENDING_CLASS,
                            onClick: (e: Event) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // 1. Programmatically select the block (engine selection utility)
                                engine.display(annotation.cfiRange);

                                setTimeout(() => {
                                    engine.selectRange(annotation.cfiRange);

                                    // 2. Dispatch state to Reader UI Store to morph the CompassPill
                                    useReaderUIStore.getState().setCompassState({
                                        variant: 'audio-triage',
                                        targetAnnotation: annotation
                                    });
                                }, 50);
                            },
                        });
                    }
                    else {
                        highlights.add('annotation', annotation.cfiRange, {
                            className: annotationClassName(annotation.color),
                            onClick: (e: Event) => {
                                const me = e as MouseEvent;
                                // Handle click on highlight to show actions (delete/edit)
                                const iframe = viewerRef.current?.querySelector('iframe');
                                let x = me.clientX;
                                let y = me.clientY;

                                if (iframe) {
                                    const iframeRect = iframe.getBoundingClientRect();
                                    x += iframeRect.left;
                                    y += iframeRect.top;
                                }
                                showPopover(x, y, annotation.cfiRange, annotation.text, annotation.id);

                                // Update Compass UI state to sync with the existing annotation
                                useReaderUIStore.getState().setCompassState({
                                    variant: 'annotation',
                                    targetAnnotation: annotation
                                });
                            },
                        });
                    }
                    // The manager logs-and-swallows epub.js failures; only
                    // track ids whose highlight actually attached (parity
                    // with the pre-manager try/catch placement).
                    if (highlights.has('annotation', annotation.cfiRange)) {
                        addedAnnotations.current.set(annotation.id, annotation.cfiRange);
                    }
                }
            });

            // (The legacy `window.__reader_added_annotations_count` global is
            // gone: E2E polls `__versicleTest.reader.highlightCount('annotation')`,
            // backed by the engine's HighlightLayerManager.)
        }
    }, [annotationList, isRenditionReady, engine, highlights, showPopover, bookId]);

    // Handle TTS Errors
    const showToast = useToastStore(state => state.showToast);

    useEffect(() => {
        if (lastError) {
            showToast(lastError, 'error');
            clearError(); // Clear immediately so it doesn't persist in TTS store
        }
    }, [lastError, showToast, clearError]);

    // Apply content analysis debug highlights (the manager's 'debug' layer
    // carries the bookkeeping the old addedDebugHighlights ref duplicated).
    useEffect(() => {
        if (!engine || !highlights || !isRenditionReady) return;

        if (!isDebugModeEnabled) {
            // Clear if disabled
            highlights.clear('debug');
            return;
        }

        const applyHighlights = async () => {
            try {
                if (currentSectionId === undefined) return;

                // Resolve the current section's index to fetch specific analysis data.
                // This avoids loading analysis for the entire book.
                // currentSectionId is checked above, but TS might not infer it for the argument
                const section = engine.resolveSection(currentSectionId!);
                if (!section) return;

                const analysis = contentAnalysisRepository.getContentAnalysis(bookId!, section.href);
                if (!analysis) return;

                if (analysis.referenceStartCfi) {
                    const highlightCfi = analysis.referenceStartCfi;

                    if (!highlights.has('debug', highlightCfi)) {
                        const color = TYPE_COLORS['reference'];
                        if (color) {
                            highlights.add('debug', highlightCfi, {
                                onClick: null,
                                styles: {
                                    fill: color,
                                    backgroundColor: color,
                                    fillOpacity: '1',
                                    mixBlendMode: currentTheme === 'dark' ? 'screen' : 'multiply'
                                },
                            });
                        }
                    }
                }
            } catch (e) {
                logger.error("Failed to apply debug highlights", e);
            }
        };

        applyHighlights();

        // Re-apply on section change or debug toggle
    }, [engine, highlights, isRenditionReady, isDebugModeEnabled, bookId, currentSectionId, currentTheme]);

    const [useSyntheticToc, setUseSyntheticToc] = useState(false);
    const [syntheticToc, setSyntheticToc] = useState<NavigationItem[]>([]);
    // Tracks whether the user has explicitly toggled the switch in this session.
    // Prevents the bookMetadata effect from overriding their choice when Yjs
    // fires an observer after updateBook (which would cause a reset race).
    const userHasExplicitlySetSyntheticToc = useRef(false);

    // Determine active TOC item based on currentSectionId (href)
    const activeTocId = useMemo(() => {
        if (!currentSectionId) return null;
        const currentToc = useSyntheticToc ? syntheticToc : toc;
        const resolvedItem = findTocItem(currentToc, currentSectionId);
        return resolvedItem ? resolvedItem.id : null;
    }, [toc, syntheticToc, useSyntheticToc, currentSectionId]);

    // Keep currentSectionTitle in sync with the active TOC item when preference changes
    useEffect(() => {
        if (!currentSectionId) return;
        const currentToc = useSyntheticToc ? syntheticToc : toc;
        const resolvedItem = findTocItem(currentToc, currentSectionId);
        if (resolvedItem && resolvedItem.label !== currentSectionTitle) {
            setCurrentSection(resolvedItem.label, currentSectionId);
        }
    }, [toc, syntheticToc, useSyntheticToc, currentSectionId, currentSectionTitle, setCurrentSection]);

    // Smart TOC Hook
    const { enhanceTOC, isEnhancing, progress: tocProgress } = useSmartTOC(
        engine,
        bookId,
        toc,
        setSyntheticToc
    );

    const [lexiconOpen, setLexiconOpen] = useState(false);
    const [lexiconText] = useState('');

    const { setGlobalSettingsOpen } = useUIStore();

    // Search State
    const [syncPanelOpen, setSyncPanelOpen] = useState(false);

    // Reset the explicit-set guard whenever the user navigates to a different book
    useEffect(() => {
        userHasExplicitlySetSyntheticToc.current = false;
    }, [bookId]);

    // Load synthetic TOC from metadata
    useEffect(() => {
        if (bookMetadata) {
            if (bookMetadata.syntheticToc) {
                setSyntheticToc(bookMetadata.syntheticToc);
            } else {
                setSyntheticToc([]);
            }

            // Only initialize useSyntheticToc from metadata if the user hasn't
            // explicitly toggled it. When updateBook is called, the Yjs-backed store
            // fires an observer which re-triggers this effect — without this guard,
            // that causes a reset race that clears the toggle.
            if (!userHasExplicitlySetSyntheticToc.current) {
                // bookMetadata.syntheticToc is always set from static_structure.toc (the original
                // epub TOC), so we can't use its presence to infer whether AI titles exist.
                // Only trust the explicit useSyntheticToc flag saved in the Yjs store.
                setUseSyntheticToc(bookMetadata.useSyntheticToc === true);
            }
        }
    }, [bookMetadata]);


    const handlePrev = useCallback(() => {
        // logger.debug("Navigating to previous page");
        engine?.prev();
    }, [engine]);

    const handleNext = useCallback(() => {
        // logger.debug("Navigating to next page");
        engine?.next();
    }, [engine]);

    // Listen for custom chapter navigation events from CompassPill
    useEffect(() => {
        const handleChapterNav = (e: CustomEvent<{ direction: 'next' | 'prev' }>) => {
            const { status } = useTTSPlaybackStore.getState();
            const isTTSActive = status !== 'stopped';

            if (isTTSActive) {
                if (e.detail.direction === 'next') {
                    audio.skipToNextSection();
                } else {
                    audio.skipToPreviousSection();
                }
            } else {
                if (e.detail.direction === 'next') handleNext();
                else handlePrev();
            }
        };

        window.addEventListener('reader:chapter-nav', handleChapterNav as EventListener);
        return () => window.removeEventListener('reader:chapter-nav', handleChapterNav as EventListener);
    }, [handleNext, handlePrev, audio]);

    const scrollToText = (text: string) => {
        const iframe = viewerRef.current?.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            const doc = iframe.contentDocument;
            if (!doc) return;

            // Method 1: window.find
            iframe.contentWindow.getSelection()?.removeAllRanges();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const found = (iframe.contentWindow as any).find(text, false, false, true, false, false, false);

            let element: HTMLElement | null = null;
            let range: Range | null = null;

            if (found) {
                const selection = iframe.contentWindow.getSelection();
                if (selection && selection.rangeCount > 0) {
                    range = selection.getRangeAt(0);
                    element = range.startContainer.parentElement;
                }
            } else {
                // Method 2: TreeWalker (Fallback)
                const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
                let node;
                while ((node = walker.nextNode())) {
                    if (node.textContent?.toLowerCase().includes(text.toLowerCase())) {
                        range = doc.createRange();
                        range.selectNodeContents(node);
                        element = node.parentElement;

                        // Highlight selection
                        const selection = iframe.contentWindow.getSelection();
                        selection?.removeAllRanges();
                        selection?.addRange(range);
                        break;
                    }
                }
            }

            if (element) {
                if (readerViewMode === 'scrolled') {
                    const wrapper = viewerRef.current?.firstElementChild as HTMLElement;
                    if (wrapper && wrapper.scrollHeight > wrapper.clientHeight) {
                        const rect = element.getBoundingClientRect();
                        // rect.top is relative to the iframe document top (which is full height)
                        // Center the element in the wrapper
                        const targetTop = rect.top - (wrapper.clientHeight / 2) + (rect.height / 2);
                        wrapper.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
                    } else {
                        element.scrollIntoView({ behavior: 'auto', block: 'center' });
                    }
                } else {
                    element.scrollIntoView({ behavior: 'auto', block: 'center' });
                }
                return;
            }
        }
    };


    const handlePlayFromSelection = useCallback((cfiRange: string) => {
        // The queue is engine state replicated into the store via the engine subscription.
        const queue = useTTSPlaybackStore.getState().queue;
        if (!queue || queue.length === 0 || !engine) return;

        try {
            // Get range for selection (sync, rendered-content range — the
            // queue covers the displayed section)
            const selectionRange = engine.getRenderedRange(cfiRange);
            if (!selectionRange) return;

            let bestIndex = -1;
            for (let i = 0; i < queue.length; i++) {
                const item = queue[i];
                if (!item.cfi) continue;

                // Get range for item
                const itemRange = engine.getRenderedRange(item.cfi);
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
            logger.error("Error matching CFI for playback", e);
        }
    }, [engine, audio]);

    // Register play callback
    useEffect(() => {
        setPlayFromSelection(handlePlayFromSelection);
        return () => setPlayFromSelection(undefined);
    }, [handlePlayFromSelection, setPlayFromSelection]);

    // Compute device markers for TOC
    const devices = useDeviceStore(state => state.devices);
    const showToc = activeSidebar === 'toc';
    const currentDeviceId = getDeviceId();

    // Optimization: Subscribe only to OTHER devices' progress to avoid re-renders on own progress update
    const otherDevicesProgress = useReadingStateStore(useShallow(state => {
        if (!bookId) return {};
        const bookProgress = state.progress?.[bookId];
        if (!bookProgress) return {};

        const result: Record<string, import('~types/db').UserProgress> = {};
        for (const [deviceId, prog] of Object.entries(bookProgress)) {
            if (deviceId !== currentDeviceId) {
                result[deviceId] = prog;
            }
        }
        return result;
    }));

    const deviceMarkers = useMemo(() => {
        const markers: Record<string, Array<{ id: string; name: string; platform: string }>> = {};
        // Optimization: Skip computation if TOC is hidden
        if (!showToc || !bookId || !engine) return markers;

        Object.entries(otherDevicesProgress).forEach(([devId, prog]) => {
            if (!prog.currentCfi) return;

            try {
                // Resolve CFI to Spine Item to get href
                const section = engine.resolveSection(prog.currentCfi);
                if (section && section.href) {
                    // We match against the raw href from spine. 
                    // Ideally TOC items matching this href (or base of it) should show the marker.
                    const href = section.href;
                    if (!markers[href]) markers[href] = [];

                    const device = devices[devId];
                    markers[href].push({
                        id: devId,
                        name: device?.name || 'Unknown Device',
                        platform: device?.platform || 'desktop'
                    });
                }
            } catch {
                // Ignore invalid CFIs
            }
        });
        return markers;
    }, [showToc, bookId, otherDevicesProgress, engine, devices]);
    const showAnnotations = activeSidebar === 'annotations';
    const showSearch = activeSidebar === 'search';

    // Navigation handling (Keyboard, Touch, Wheel)
    useReaderNavigation({
        engine,
        readerViewMode,
        handlePrev,
        handleNext,
        scrollWrapperRef,
        viewerRef
    });
    
    return (
        <div
            data-testid="reader-view"
            className="flex flex-col h-screen bg-background text-foreground relative"
            onClick={() => {
                hidePopover();
                useReaderUIStore.getState().resetCompassState();
            }}
        >
            <Dialog
                isOpen={showImportJumpDialog}
                onClose={handleJumpCancel}
                title={isWaitingForJump ? "Locating..." : "Resume from Reading List?"}
                description={
                    isWaitingForJump
                        ? "Please wait while we calculate the page position..."
                        : `This book has progress saved in your reading list (${Math.round(importJumpTarget * 100)}%). Would you like to jump to this location?`
                }
                footer={
                    <>
                        <Button variant="ghost" onClick={handleJumpCancel} disabled={isWaitingForJump}>
                            {isWaitingForJump ? "Cancel" : "No, start from beginning"}
                        </Button>
                        <Button onClick={handleJumpConfirm} disabled={isWaitingForJump}>
                            {isWaitingForJump ? "Calculating..." : "Yes, jump to location"}
                        </Button>
                    </>
                }
            />

            <ReaderTTSController
                engine={engine}
                viewMode={readerViewMode}
            />

            {/* Immersive Mode Exit Button */}
            {immersiveMode && (
                <Button
                    variant="ghost"
                    size="icon"
                    data-testid="reader-immersive-exit-button"
                    aria-label="Exit Immersive Mode"
                    onClick={() => setImmersiveMode(false)}
                    className="absolute top-4 right-4 z-50 rounded-full bg-surface/50 hover:bg-surface shadow-md backdrop-blur-sm transition-colors"
                >
                    <Minimize className="w-5 h-5 text-foreground" />
                </Button>
            )}

            {/* Header */}
            {!immersiveMode && (
                <header data-testid="reader-header" className="flex items-center justify-between px-2 md:px-8 py-2 bg-surface shadow-sm z-10">
                    <div className="flex items-center gap-1 md:gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-back-button"
                            aria-label={activeSidebar !== 'none' ? "Close Side Bar" : "Back to Library"}
                            onClick={() => {
                                if (activeSidebar !== 'none') {
                                    setSidebar('none');
                                } else {
                                    // flushSync: React Router 7 wraps navigations in startTransition by
                                    // default; on WebKit that transition can be starved when nothing else
                                    // re-renders (e.g. TTS idle), so the URL updates but the route never
                                    // re-renders and the reader→library transition wedges. Force a
                                    // synchronous navigation so it always completes.
                                    navigate('/', { flushSync: true });
                                }
                            }}
                            className="rounded-full text-muted-foreground"
                        >
                            {activeSidebar !== 'none' ? <X className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-toc-button"
                            aria-label="Table of Contents"
                            onClick={() => {
                                if (activeSidebar === 'toc') setSidebar('none');
                                else setSidebar('toc');
                            }}
                            className={cn("rounded-full text-muted-foreground", showToc && "bg-accent text-accent-foreground")}
                        >
                            <List className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-annotations-button"
                            aria-label="Annotations"
                            onClick={() => {
                                if (activeSidebar === 'annotations') setSidebar('none');
                                else setSidebar('annotations');
                            }}
                            className={cn("rounded-full text-muted-foreground", showAnnotations && "bg-accent text-accent-foreground")}
                        >
                            <Highlighter className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-search-button"
                            aria-label="Search"
                            onClick={() => {
                                if (activeSidebar === 'search') {
                                    setSidebar('none');
                                } else {
                                    setSidebar('search');
                                }
                            }}
                            className="rounded-full text-muted-foreground"
                        >
                            <Search className="w-5 h-5" />
                        </Button>
                    </div>
                    <h1 className="text-sm font-medium truncate max-w-xs text-foreground hidden md:block">
                        {currentSectionTitle || bookMetadata?.title || 'Reading'}
                    </h1>
                    <div className="flex items-center gap-1 md:gap-2">
                        <Sheet open={activeSidebar === 'audio-panel'} onOpenChange={(open) => setSidebar(open ? 'audio-panel' : 'none')}>
                            <SheetTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    data-testid="reader-audio-button"
                                    aria-label="Open Audio Deck"
                                    className={cn("rounded-full", isPlaying ? "text-primary" : "text-muted-foreground")}
                                >
                                    <Headphones className="w-5 h-5" />
                                </Button>
                            </SheetTrigger>
                            <UnifiedAudioPanel />
                        </Sheet>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-immersive-enter-button"
                            aria-label="Enter Immersive Mode"
                            onClick={() => setImmersiveMode(true)}
                            className="rounded-full text-muted-foreground"
                        >
                            <Maximize className="w-5 h-5" />
                        </Button>
                        <Popover open={activeSidebar === 'visual-settings'} onOpenChange={(open) => setSidebar(open ? 'visual-settings' : 'none')}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    data-testid="reader-visual-settings-button"
                                    aria-label="Visual Settings"
                                    className="rounded-full text-muted-foreground"
                                >
                                    <Type className="w-5 h-5" />
                                </Button>
                            </PopoverTrigger>
                            <VisualSettings />
                        </Popover>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-sync-status-button"
                            aria-label="Sync Status"
                            onClick={() => setSyncPanelOpen(true)}
                            className="rounded-full text-muted-foreground"
                        >
                            <Monitor className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            data-testid="reader-settings-button"
                            aria-label="Settings"
                            onClick={() => setGlobalSettingsOpen(true)}
                            className="rounded-full text-muted-foreground"
                        >
                            <Settings className="w-5 h-5" />
                        </Button>
                    </div>
                </header>
            )
            }

            {/* Main Content */}
            <div className="flex-1 relative overflow-hidden flex justify-center">
                {/* TOC Sidebar (now includes History) */}
                {showToc && (
                    <TOCPanel
                        toc={toc}
                        syntheticToc={syntheticToc}
                        useSyntheticToc={useSyntheticToc}
                        onUseSyntheticTocChange={(val) => {
                            userHasExplicitlySetSyntheticToc.current = true;
                            setUseSyntheticToc(val);
                            if (bookId) {
                                useBookStore.getState().updateBook(bookId, { useSyntheticToc: val });
                            }
                        }}
                        activeTocId={activeTocId ?? undefined}
                        deviceMarkers={deviceMarkers}
                        onNavigate={(href) => {
                            // Dragnet invalidation moved INSIDE the TTS engine (5b-PR4): the
                            // DragnetGesture unit disarms on the engine's own section-index
                            // change, so the TOC handler no longer pokes the engine.
                            engine?.display(href);
                            setSidebar('none');
                        }}
                        isEnhancing={isEnhancing}
                        tocProgress={tocProgress}
                        onEnhanceTOC={enhanceTOC}
                        bookId={bookId || ''}
                        engine={engine ?? undefined}
                        historyTick={historyTick}
                        onHistoryNavigate={(cfi) => {
                            engine?.display(cfi);
                        }}
                    />
                )}

                {/* Pinyin Overlay (Ephemeral UI) */}
                <PinyinOverlay
                    positions={pinyinPositions}
                    pinyinSize={pinyinSize}
                    containerNode={containerNode}
                />

                {/* Note Markers Overlay */}
                <AnnotationMarkerOverlay
                    markers={markers}
                    onMarkerClick={(x, y, cfi, text, id) => {
                        // 1. Update Annotation store popover state (for color/delete etc)
                        showPopover(x, y, cfi, text, id);

                        // 2. Update Compass UI state to morph the pill
                        const annotation = annotationList.find(a => a.id === id);
                        if (annotation) {
                            useReaderUIStore.getState().setCompassState({
                                variant: 'annotation',
                                targetAnnotation: annotation
                            });
                        }
                    }}
                    containerNode={containerNode}
                />

                {/* Annotation List Overlay */}
                {showAnnotations && (
                    <div data-testid="reader-annotations-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 flex flex-col">
                        <div className="p-4 border-b border-border">
                            <h2 className="text-lg font-bold text-foreground">Annotations</h2>
                        </div>
                        <AnnotationList
                            bookId={bookId}
                            onNavigate={(cfi) => {
                                engine?.display(cfi);
                                if (window.innerWidth < 768) setSidebar('none');
                            }}
                        />
                    </div>
                )}

                {/* Search Sidebar */}
                {showSearch && (
                    <SearchPanel
                        bookId={bookId}
                        book={book}
                        onNavigate={async (href, query) => {
                            if (engine) {
                                await engine.display(href);
                                setTimeout(() => {
                                    scrollToText(query);
                                }, 500);
                            }
                        }}
                    />
                )}

                {/* Reader Area */}
                <div
                    ref={scrollWrapperRef}
                    className="flex-1 relative min-w-0 flex flex-col items-center"
                >
                    <div
                        data-testid="reader-iframe-container"
                        ref={viewerRef}
                        className="w-full max-w-2xl overflow-hidden px-6 md:px-8 transition-opacity duration-300 opacity-100"
                        style={{ height: readerViewMode === 'paginated' ? 'calc(100% - 100px)' : '100%' }}
                    />

                    <LexiconManager open={lexiconOpen} onOpenChange={setLexiconOpen} initialTerm={lexiconText} />
                </div>
            </div>

            {/* Content Analysis Debug Legend */}
            <ContentAnalysisLegend engine={engine} />

            <SyncStatusPanel
                open={syncPanelOpen}
                onOpenChange={setSyncPanelOpen}
                bookId={bookId || ''}
                onJump={(cfi) => {
                    engine?.display(cfi);
                }}
            />
            <HistoryHighlighter
                highlights={highlights}
                isRenditionReady={isRenditionReady}
                bookId={bookId || null}
                isPlaying={isPlaying}
            />

            <ReaderHighlightsStyles currentTheme={currentTheme} />
        </div>
    );
};
