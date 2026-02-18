import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { NavigationItem } from 'epubjs';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useBook } from '../../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { useTTSStore } from '../../store/useTTSStore';
import { useUIStore } from '../../store/useUIStore';
import { useTTS } from '../../hooks/useTTS';
import { useEpubReader, type EpubReaderOptions } from '../../hooks/useEpubReader';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { AnnotationList } from './AnnotationList';
import { LexiconManager } from './LexiconManager';
import { VisualSettings } from './VisualSettings';
import { UnifiedInputController } from './UnifiedInputController';
import { useToastStore } from '../../store/useToastStore';
import { Popover, PopoverTrigger } from '../ui/Popover';
import { Sheet, SheetTrigger } from '../ui/Sheet';
import { UnifiedAudioPanel } from './UnifiedAudioPanel';
import { dbService } from '../../db/DBService';
import { searchClient, type SearchResult } from '../../lib/search';
import { SyncStatusPanel } from './SyncStatusPanel';
import { List, Settings, ArrowLeft, X, Search, Highlighter, Maximize, Minimize, Type, Headphones, Monitor } from 'lucide-react';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';
import { ReaderTTSController } from './ReaderTTSController';
import { generateCfiRange, snapCfiToSentence } from '../../lib/cfi-utils';
import { TOCPanel, SearchPanel } from './panels';
import { Button } from '../ui/Button';
import { useSmartTOC } from '../../hooks/useSmartTOC';

import { cn } from '../../lib/utils';
import { Dialog } from '../ui/Dialog';
import { useSidebarState } from '../../hooks/useSidebarState';
import { useGenAIStore } from '../../store/useGenAIStore';
import { ContentAnalysisLegend } from './ContentAnalysisLegend';
import { TYPE_COLORS } from '../../types/content-analysis';
import { CURRENT_BOOK_VERSION } from '../../lib/constants';
import { createLogger } from '../../lib/logger';
import { useDeviceStore } from '../../store/useDeviceStore';
import { getDeviceId } from '../../lib/device-id';
import { useHistoryHighlights } from './useHistoryHighlights';

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
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { activeSidebar, setSidebar } = useSidebarState();
    const viewerRef = useRef<HTMLDivElement>(null);
    const previousLocation = useRef<{ start: string; end: string; timestamp: number } | null>(null);

    const {
        currentTheme,
        customTheme,
        fontFamily,
        lineHeight,
        fontSize,
        shouldForceFont,
        readerViewMode
    } = usePreferencesStore(useShallow(state => ({
        currentTheme: state.currentTheme,
        customTheme: state.customTheme || DEFAULT_CUSTOM_THEME,
        fontFamily: state.fontFamily,
        lineHeight: state.lineHeight || 1.5,
        fontSize: state.fontSize,
        shouldForceFont: state.shouldForceFont,
        readerViewMode: state.readerViewMode || 'paginated'
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
        resetUI
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
        resetUI: state.reset
    })));

    logger.debug(`viewMode: ${readerViewMode}, immersive: ${immersiveMode}`);

    const panicSaveState = useRef({ readerViewMode, currentSectionTitle });

    useEffect(() => {
        panicSaveState.current = { readerViewMode, currentSectionTitle };
    }, [readerViewMode, currentSectionTitle]);

    // Select current book metadata and progress from stores (Phase 2)
    const rawBookMetadata = useBook(id || null);
    const bookMetadata = useMemo(() => {
        if (!rawBookMetadata) return null;
        return {
            ...rawBookMetadata,
            coverBlob: rawBookMetadata.coverBlob || undefined // Convert null to undefined for compatibility
        };
    }, [rawBookMetadata]);
    const progress = useReadingStateStore(state => id ? state.getProgress(id) : null);

    const reset = useCallback(() => {
        resetUI();
        // Do NOT reset reading state (progress), as that wipes user data!
    }, [resetUI]);

    // Optimization: Select only necessary state to prevent re-renders on every activeCfi/currentIndex change
    const isPlaying = useTTSStore(state => state.isPlaying);
    const lastError = useTTSStore(state => state.lastError);
    const clearError = useTTSStore(state => state.clearError);
    const isDebugModeEnabled = useGenAIStore(state => state.isDebugModeEnabled);

    const {
        annotations,
        loadAnnotations,
        showPopover,
        hidePopover
    } = useAnnotationStore();

    const [historyTick, setHistoryTick] = useState(0);

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
        fontSize,
        lineHeight,
        shouldForceFont,
        initialLocation: progress?.currentCfi,
        metadata: bookMetadata,
        onLocationChange: (location, percentage, title, sectionId) => {
            // Initialize previousLocation if it's null (e.g. initial load), so we can track subsequent moves
            if (!previousLocation.current) {
                previousLocation.current = {
                    start: location.start.cfi,
                    end: location.end.cfi,
                    timestamp: Date.now()
                };
            }

            // Import Jump Check
            // If we have metadata, no saved CFI (never opened), but have progress (from import), and haven't prompted yet.
            // And current position is effectively start.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const meta = metadataRef.current as any;
            if (meta && !meta.currentCfi && meta.progress > 0 && !hasPromptedForImport.current && id) {
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
            const currentProgress = useReadingStateStore.getState().getProgress(id || '');
            if (location.start.cfi === (currentProgress?.currentCfi || '')) return;

            // Reading History
            if (id && previousLocation.current) {
                const prevStart = previousLocation.current.start;
                const prevEnd = previousLocation.current.end;
                const duration = Date.now() - previousLocation.current.timestamp;
                const isScroll = readerViewMode === 'scrolled';
                const shouldSave = isScroll ? duration > 2000 : true;

                if (prevStart && prevEnd && prevStart !== location.start.cfi && shouldSave) {
                    const currentBook = bookRef.current;
                    // Capture title synchronously before async op to avoid race condition with setCurrentSection
                    const previousSectionTitle = panicSaveState.current.currentSectionTitle;

                    if (currentBook) {
                        Promise.all([
                            snapCfiToSentence(currentBook, prevStart),
                            snapCfiToSentence(currentBook, prevEnd)
                        ]).then(([snappedStart, snappedEnd]) => {
                            const range = generateCfiRange(snappedStart, snappedEnd);
                            const type = isScroll ? 'scroll' : 'page';
                            const label = previousSectionTitle || undefined;

                            // Ignore generic "Chapter" placeholder to prevent ghost entries
                            if (label === 'Chapter') return;

                            try {
                                useReadingStateStore.getState().addCompletedRange(id, range, type, label);
                                setHistoryTick(t => t + 1);
                            } catch (err) {
                                logger.error("History update failed", err);
                                useToastStore.getState().showToast('Failed to save reading history', 'error');
                            }
                        });
                    }
                }
            }
            previousLocation.current = {
                start: location.start.cfi,
                end: location.end.cfi,
                timestamp: Date.now()
            };

            if (id) {
                useReadingStateStore.getState().updateLocation(id, location.start.cfi, percentage);
                // Ensure current segment is in history so it appears at top of list
                const range = generateCfiRange(location.start.cfi, location.end.cfi);
                const type = readerViewMode === 'scrolled' ? 'scroll' : 'page';
                useReadingStateStore.getState().addCompletedRange(id, range, type, title);
            }
            setCurrentSection(title, sectionId);
        },
        onTocLoaded: (newToc) => setToc(newToc),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        onSelection: (cfiRange, range, _contents) => {
            const rect = range.getBoundingClientRect();
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
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        onBookLoaded: (_book) => {
            // Indexing is now deferred until search is opened
        },
        onClick: (e: MouseEvent) => {
            const selection = e.view?.getSelection();
            if (!selection || selection.isCollapsed) {
                hidePopover();
            }
        },
        onError: (msg) => {
            logger.error("Reader Error:", msg);
        }
    }), [
        readerViewMode,
        currentTheme,
        customTheme,
        fontFamily,
        fontSize,
        lineHeight,
        shouldForceFont,
        id,
        // updateLocation,
        setToc,
        showPopover,
        hidePopover,
        bookMetadata,
        progress?.currentCfi,
        setCurrentSection
    ]);

    const {
        rendition,
        book,
        isReady: isRenditionReady,
        areLocationsReady,
        isLoading: hookLoading,
        metadata,
        error: hookError
    } = useEpubReader(id, viewerRef as React.RefObject<HTMLElement>, readerOptions);

    useEffect(() => {
        metadataRef.current = metadata;

        // Check version and redirect if outdated
        if (metadata) {
            const effectiveVersion = metadata.version ?? 0;
            if (effectiveVersion < CURRENT_BOOK_VERSION && id) {
                navigate('/', { state: { reprocessBookId: id } });
            }
        }
    }, [metadata, id, navigate]);

    const bookRef = useRef(book);
    useEffect(() => {
        bookRef.current = book;
    }, [book]);

    // Sync loading state
    useEffect(() => {
        setIsLoading(hookLoading);
    }, [hookLoading, setIsLoading]);

    // Expose rendition for testing
    useEffect(() => {
        if (rendition) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).rendition = rendition;
        }
    }, [rendition]);

    // Register jumpToLocation
    const { setJumpToLocation } = useReaderUIStore(useShallow(state => ({
        setJumpToLocation: state.setJumpToLocation
    })));

    useEffect(() => {
        if (setJumpToLocation && rendition) {
            setJumpToLocation((cfi) => {
                try {
                    rendition.display(cfi);
                } catch (e) {
                    logger.error("Failed to jump to location", e);
                }
            });
            // Cleanup provided in store reset, effectively replacement overrides previous
        }
    }, [setJumpToLocation, rendition]);

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
        if (id) {
            AudioPlayerService.getInstance().setBookId(id);
            setCurrentBookId(id);
        }
    }, [id, setCurrentBookId]);

    // Save reading history on unmount
    useEffect(() => {
        return () => {
            if (id && previousLocation.current) {
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
                            useReadingStateStore.getState().addCompletedRange(id, range, type, label);
                        } catch (e) {
                            logger.error("History panic save failed", e);
                        }
                    }
                }
            }
        };
    }, [id]);

    // Handle Unmount Cleanup
    useEffect(() => {
        return () => {
            searchClient.terminate();
            setCurrentBookId(null);
            reset();
            // Ensure popover is hidden when leaving the reader
            hidePopover();
        };
    }, [reset, hidePopover, setCurrentBookId]);

    const handleClearSelection = useCallback(() => {
        const iframe = viewerRef.current?.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.getSelection()?.removeAllRanges();
        }
    }, []);

    // Clear selection when popover is hidden
    const popoverVisible = useAnnotationStore(state => state.popover.visible);
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
        if (id) {
            loadAnnotations(id);
        }
    }, [id, loadAnnotations]);

    const handleJumpConfirm = async () => {
        if (areLocationsReady) {
            setShowImportJumpDialog(false);
            if (book && rendition) {
                try {
                    const cfi = book.locations.cfiFromPercentage(importJumpTarget);
                    if (cfi) {
                        await rendition.display(cfi);
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
        if (id) {
            const currentProgress = useReadingStateStore.getState().getProgress(id);
            const currentCfi = currentProgress?.currentCfi;
            // updateLocation handles saving to Yjs
            if (currentCfi) {
                useReadingStateStore.getState().updateLocation(id, currentCfi, currentProgress?.percentage || 0);
            }
        }
    };

    // Watch for locations to become ready if waiting
    useEffect(() => {
        // If we are waiting, and the capability arrives...
        if (isWaitingForJump && areLocationsReady && book && rendition) {
            try {
                const cfi = book.locations.cfiFromPercentage(importJumpTarget);
                if (cfi) {
                    rendition.display(cfi);
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
    }, [isWaitingForJump, areLocationsReady, book, rendition, importJumpTarget]);

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
    const addedAnnotations = useRef<Set<string>>(new Set());

    // Helper to get annotation styles object for epub.js
    const getAnnotationStyles = (color: string) => {
        switch (color) {
            case 'red': return { fill: 'red', backgroundColor: 'rgba(255, 0, 0, 0.3)', fillOpacity: '0.3', mixBlendMode: 'multiply' };
            case 'green': return { fill: 'green', backgroundColor: 'rgba(0, 255, 0, 0.3)', fillOpacity: '0.3', mixBlendMode: 'multiply' };
            case 'blue': return { fill: 'blue', backgroundColor: 'rgba(0, 0, 255, 0.3)', fillOpacity: '0.3', mixBlendMode: 'multiply' };
            default: return { fill: 'yellow', backgroundColor: 'rgba(255, 255, 0, 0.3)', fillOpacity: '0.3', mixBlendMode: 'multiply' };
        }
    };

    useEffect(() => {
        if (rendition && isRenditionReady) {
            // Add new annotations
            const annotationList = Object.values(annotations);
            annotationList.forEach(annotation => {
                if (!addedAnnotations.current.has(annotation.id)) {
                    const className = annotation.color === 'yellow' ? 'highlight-yellow' :
                        annotation.color === 'green' ? 'highlight-green' :
                            annotation.color === 'blue' ? 'highlight-blue' :
                                annotation.color === 'red' ? 'highlight-red' : 'highlight-yellow';

                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (rendition as any).annotations.add('highlight', annotation.cfiRange, {}, () => {
                            // logger.debug("Clicked annotation", annotation.id);
                        }, className, getAnnotationStyles(annotation.color));
                        addedAnnotations.current.add(annotation.id);
                    } catch (e) {
                        logger.warn(`Failed to add annotation ${annotation.id}`, e);
                    }
                }
            });

            // Expose for testing
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__reader_added_annotations_count = addedAnnotations.current.size;
        }
    }, [annotations, isRenditionReady, rendition]);

    // Handle TTS Errors
    const showToast = useToastStore(state => state.showToast);

    useEffect(() => {
        if (lastError) {
            showToast(lastError, 'error');
            clearError(); // Clear immediately so it doesn't persist in TTS store
        }
    }, [lastError, showToast, clearError]);

    // Apply content analysis debug highlights
    const addedDebugHighlights = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!rendition || !isRenditionReady) return;

        if (!isDebugModeEnabled) {
            // Clear if disabled
            addedDebugHighlights.current.forEach(cfi => {
                try {
                    // @ts-expect-error annotations is not typed fully
                    rendition.annotations.remove(cfi, 'highlight');
                } catch (e) {
                    logger.warn("Failed to remove debug highlight", e);
                }
            });
            addedDebugHighlights.current.clear();
            return;
        }

        const applyHighlights = async () => {
            try {
                if (currentSectionId === undefined || !book) return;

                // Resolve the current section's index to fetch specific analysis data.
                // This avoids loading analysis for the entire book.
                // currentSectionId is checked above, but TS might not infer it for the argument
                const section = book.spine.get(currentSectionId!);
                if (!section) return;

                const analysis = await dbService.getContentAnalysis(id!, section.href);
                if (!analysis) return;

                if (analysis.contentTypes) {
                    const items = analysis.contentTypes;
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        // Skip if already added
                        if (addedDebugHighlights.current.has(item.rootCfi)) continue;

                        const highlightCfi = item.rootCfi;

                        const color = TYPE_COLORS[item.type];
                        if (color) {
                            try {
                                // @ts-expect-error annotations is not typed fully
                                rendition.annotations.add('highlight', highlightCfi, {}, null, 'debug-analysis-highlight', {
                                    fill: color,
                                    backgroundColor: color,
                                    fillOpacity: '1',
                                    mixBlendMode: 'multiply'
                                });
                                addedDebugHighlights.current.add(item.rootCfi);
                            } catch (e) {
                                logger.warn("Failed to add debug highlight", e);
                            }
                        }
                    }
                }
            } catch (e) {
                logger.error("Failed to apply debug highlights", e);
            }
        };

        applyHighlights();

        // Re-apply on section change or debug toggle
    }, [rendition, isRenditionReady, isDebugModeEnabled, id, currentSectionId, book]);

    // Reading History Highlights
    useHistoryHighlights(
        rendition,
        isRenditionReady,
        id || null,
        progress?.currentCfi,
        isPlaying,
        progress?.lastPlayedCfi
    );

    const [useSyntheticToc, setUseSyntheticToc] = useState(false);
    const [syntheticToc, setSyntheticToc] = useState<NavigationItem[]>([]);

    // Determine active TOC item based on currentSectionId (href)
    const activeTocId = useMemo(() => {
        if (!currentSectionId) return null;
        let bestMatchId: string | null = null;

        const currentToc = useSyntheticToc ? syntheticToc : toc;

        const traverse = (items: NavigationItem[]): boolean => {
            for (const item of items) {
                const itemPath = item.href.split('#')[0];
                const sectionPath = currentSectionId.split('#')[0];

                if (itemPath === sectionPath) {
                    // Found a file match.
                    // If we have not found a match yet, take this one (likely the parent/chapter start)
                    if (!bestMatchId) {
                        bestMatchId = item.id;
                    }
                    // If we find an exact match (including hash if any), that's definitely the one
                    if (item.href === currentSectionId) {
                        bestMatchId = item.id;
                        return true;
                    }
                }
                if (item.subitems && item.subitems.length > 0) {
                    if (traverse(item.subitems)) return true;
                }
            }
            return false;
        };

        traverse(currentToc);
        return bestMatchId;
    }, [toc, syntheticToc, useSyntheticToc, currentSectionId]);

    // Smart TOC Hook
    const { enhanceTOC, isEnhancing, progress: tocProgress } = useSmartTOC(
        book,
        id,
        toc,
        setSyntheticToc
    );

    const [lexiconOpen, setLexiconOpen] = useState(false);
    const [lexiconText] = useState('');

    const { setGlobalSettingsOpen } = useUIStore();

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearchQuery, setActiveSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [syncPanelOpen, setSyncPanelOpen] = useState(false);

    // Indexing State
    const [isIndexing, setIsIndexing] = useState(false);
    const [indexingProgress, setIndexingProgress] = useState(0);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) return;
        setIsSearching(true);
        setActiveSearchQuery(searchQuery);
        try {
            const results = await searchClient.search(searchQuery, id || '');
            setSearchResults(results);
        } catch (e) {
            logger.error("Search failed", e);
            showToast("Search failed", "error");
        } finally {
            setIsSearching(false);
        }
    }, [searchQuery, id, showToast]);

    const handleCheckIndex = useCallback(async () => {
        if (!id || !book) return;
        if (searchClient.isIndexed(id)) return;

        setIsIndexing(true);
        try {
            await searchClient.indexBook(book, id, (progress) => {
                setIndexingProgress(Math.round(progress * 100));
            });
        } finally {
            setIsIndexing(false);
        }
    }, [id, book]);

    // Load synthetic TOC from metadata
    useEffect(() => {
        if (metadata?.syntheticToc) {
            setSyntheticToc(metadata.syntheticToc);
        } else {
            setSyntheticToc([]);
        }
    }, [metadata]);


    const handlePrev = useCallback(() => {
        // logger.debug("Navigating to previous page");
        rendition?.prev();
    }, [rendition]);

    const handleNext = useCallback(() => {
        // logger.debug("Navigating to next page");
        rendition?.next();
    }, [rendition]);

    // Listen for custom chapter navigation events from CompassPill
    useEffect(() => {
        const handleChapterNav = (e: CustomEvent<{ direction: 'next' | 'prev' }>) => {
            const { status } = useTTSStore.getState();
            const isTTSActive = status !== 'stopped';

            if (isTTSActive) {
                if (e.detail.direction === 'next') {
                    AudioPlayerService.getInstance().skipToNextSection();
                } else {
                    AudioPlayerService.getInstance().skipToPreviousSection();
                }
            } else {
                if (e.detail.direction === 'next') handleNext();
                else handlePrev();
            }
        };

        window.addEventListener('reader:chapter-nav', handleChapterNav as EventListener);
        return () => window.removeEventListener('reader:chapter-nav', handleChapterNav as EventListener);
    }, [handleNext, handlePrev]);

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
        const queue = AudioPlayerService.getInstance().getQueue();
        if (!queue || queue.length === 0 || !rendition) return;

        try {
            // Get range for selection
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const selectionRange = (rendition as any).getRange(cfiRange);
            if (!selectionRange) return;

            let bestIndex = -1;
            for (let i = 0; i < queue.length; i++) {
                const item = queue[i];
                if (!item.cfi) continue;

                // Get range for item
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const itemRange = (rendition as any).getRange(item.cfi);
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
                AudioPlayerService.getInstance().jumpTo(bestIndex);
            }
        } catch (e) {
            logger.error("Error matching CFI for playback", e);
        }
    }, [rendition]);

    // Register play callback
    useEffect(() => {
        setPlayFromSelection(handlePlayFromSelection);
        return () => setPlayFromSelection(undefined);
    }, [handlePlayFromSelection, setPlayFromSelection]);

    // Compute device markers for TOC
    const devices = useDeviceStore(state => state.devices);
    const { progress: allProgress } = useReadingStateStore(useShallow(state => ({ progress: state.progress })));
    const currentDeviceId = getDeviceId();

    const deviceMarkers = useMemo(() => {
        const markers: Record<string, Array<{ id: string; name: string; platform: string }>> = {};
        if (!id || !allProgress[id] || !book) return markers;

        Object.entries(allProgress[id]).forEach(([devId, prog]) => {
            if (devId === currentDeviceId) return; // Skip current device
            if (!prog.currentCfi) return;

            try {
                // Resolve CFI to Spine Item to get href
                const section = book.spine.get(prog.currentCfi);
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
    }, [id, allProgress, book, devices, currentDeviceId]);

    const showToc = activeSidebar === 'toc';
    const showAnnotations = activeSidebar === 'annotations';
    const showSearch = activeSidebar === 'search';

    return (
        <div data-testid="reader-view" className="flex flex-col h-screen bg-background text-foreground relative">
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
                rendition={rendition}
                viewMode={readerViewMode}
                onPrev={handlePrev}
                onNext={handleNext}
            />

            {/* Unified Input Controller (Flow Mode) */}
            <UnifiedInputController
                rendition={rendition}
                currentSectionTitle={currentSectionTitle || ''}
                onPrev={handlePrev}
                onNext={handleNext}
                onToggleHUD={() => setImmersiveMode(!immersiveMode)}
                immersiveMode={immersiveMode}
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
                                    navigate('/');
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
                                    handleCheckIndex();
                                }
                            }}
                            className="rounded-full text-muted-foreground"
                        >
                            <Search className="w-5 h-5" />
                        </Button>
                    </div>
                    <h1 className="text-sm font-medium truncate max-w-xs text-foreground hidden md:block">
                        {metadata?.title || currentSectionTitle || 'Reading'}
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
                        onUseSyntheticTocChange={setUseSyntheticToc}
                        activeTocId={activeTocId ?? undefined}
                        deviceMarkers={deviceMarkers}
                        onNavigate={(href) => {
                            rendition?.display(href);
                            setSidebar('none');
                        }}
                        isEnhancing={isEnhancing}
                        tocProgress={tocProgress}
                        onEnhanceTOC={enhanceTOC}
                        bookId={id || ''}
                        rendition={rendition ?? undefined}
                        historyTick={historyTick}
                        onHistoryNavigate={(cfi) => {
                            rendition?.display(cfi);
                        }}
                    />
                )}

                {/* Annotations Sidebar */}
                {showAnnotations && (
                    <div data-testid="reader-annotations-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 md:static flex flex-col">
                        <div className="p-4 border-b border-border">
                            <h2 className="text-lg font-bold text-foreground">Annotations</h2>
                        </div>
                        <AnnotationList onNavigate={(cfi) => {
                            rendition?.display(cfi);
                            if (window.innerWidth < 768) setSidebar('none');
                        }} />
                    </div>
                )}

                {/* Search Sidebar */}
                {showSearch && (
                    <SearchPanel
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        onSearch={handleSearch}
                        isSearching={isSearching}
                        searchResults={searchResults}
                        activeSearchQuery={activeSearchQuery}
                        isIndexing={isIndexing}
                        indexingProgress={indexingProgress}
                        onResultClick={async (result) => {
                            if (rendition) {
                                await rendition.display(result.href);
                                setTimeout(() => {
                                    scrollToText(activeSearchQuery);
                                }, 500);
                            }
                        }}
                    />
                )}

                {/* Reader Area */}
                <div className="flex-1 relative min-w-0 flex flex-col items-center">
                    <div
                        data-testid="reader-iframe-container"
                        ref={viewerRef}
                        className={`w-full max-w-2xl overflow-hidden px-6 md:px-8 transition-opacity duration-300 ${isPlaying && immersiveMode ? 'opacity-40' : 'opacity-100'}`}
                        style={{ height: readerViewMode === 'paginated' ? 'calc(100% - 100px)' : '100%' }}
                    />

                    <LexiconManager open={lexiconOpen} onOpenChange={setLexiconOpen} initialTerm={lexiconText} />
                </div>
            </div>

            {/* Content Analysis Debug Legend */}
            <ContentAnalysisLegend rendition={rendition} />

            <SyncStatusPanel
                open={syncPanelOpen}
                onOpenChange={setSyncPanelOpen}
                bookId={id || ''}
                onJump={(cfi) => {
                    rendition?.display(cfi);
                }}
            />

            {/* Smart Resume Toast */}



        </div >
    );
};
