import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { NavigationItem } from 'epubjs';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useReaderSyncStore } from '../../store/useReaderSyncStore';
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
import { Switch } from '../ui/Switch';
import { Label } from '../ui/Label';
import { UnifiedAudioPanel } from './UnifiedAudioPanel';
import { dbService } from '../../db/DBService';
import { searchClient, type SearchResult } from '../../lib/search';
import { List, Settings, ArrowLeft, X, Search, Highlighter, Maximize, Minimize, Type, Headphones } from 'lucide-react';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';
import { ReaderTTSController } from './ReaderTTSController';
import { generateCfiRange, snapCfiToSentence } from '../../lib/cfi-utils';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { Button } from '../ui/Button';
import { useSmartTOC } from '../../hooks/useSmartTOC';
import { Wand2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Dialog } from '../ui/Dialog';
import { useSidebarState } from '../../hooks/useSidebarState';
import { useGenAIStore } from '../../store/useGenAIStore';
import { ContentAnalysisLegend } from './ContentAnalysisLegend';
import { TYPE_COLORS } from '../../types/content-analysis';
import { CURRENT_BOOK_VERSION } from '../../lib/constants';
import { useProgressStore } from '../../store/useProgressStore'; // Added import

/**
 * The main reader interface component.
 * Renders the EPUB content using epub.js and provides controls for navigation,
 * settings, Text-to-Speech (TTS), and search.
 *
 * @returns A React component for reading books.
 */
export const ReaderView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeSidebar, setSidebar } = useSidebarState();
  const viewerRef = useRef<HTMLDivElement>(null);
  const previousLocation = useRef<{ start: string; end: string; timestamp: number } | null>(null);

  const {
    updateLocationMetadata,
    toc,
    setToc,
    setIsLoading,
    setCurrentBookId,
    reset,
    currentSectionTitle,
    currentSectionId,
    viewMode,
    shouldForceFont,
    immersiveMode,
    setImmersiveMode,
    setPlayFromSelection,
  } = useReaderUIStore(useShallow(state => ({
    updateLocationMetadata: state.updateLocationMetadata,
    toc: state.toc,
    setToc: state.setToc,
    setIsLoading: state.setIsLoading,
    setCurrentBookId: state.setCurrentBookId,
    reset: state.reset,
    currentSectionTitle: state.currentSectionTitle,
    currentSectionId: state.currentSectionId,
    viewMode: state.viewMode,
    shouldForceFont: state.shouldForceFont,
    immersiveMode: state.immersiveMode,
    setImmersiveMode: state.setImmersiveMode,
    setPlayFromSelection: state.setPlayFromSelection
  })));

  const {
    currentTheme,
    customTheme,
    fontFamily,
    lineHeight,
    fontSize
  } = useReaderSyncStore(useShallow(state => ({
    currentTheme: state.currentTheme,
    customTheme: state.customTheme,
    fontFamily: state.fontFamily,
    lineHeight: state.lineHeight,
    fontSize: state.fontSize,
  })));

  const isPlaying = useTTSStore(state => state.isPlaying);
  const lastError = useTTSStore(state => state.lastError);
  const clearError = useTTSStore(state => state.clearError);
  const isDebugModeEnabled = useGenAIStore(state => state.isDebugModeEnabled);

  const {
    annotations: annotationsMap,
    addAnnotation,
    showPopover,
    hidePopover
  } = useAnnotationStore(useShallow(state => ({
    annotations: state.annotations,
    addAnnotation: state.addAnnotation,
    showPopover: state.showPopover,
    hidePopover: state.hidePopover
  })));

  const annotations = useMemo(() => Object.values(annotationsMap), [annotationsMap]);

  const [historyTick, setHistoryTick] = useState(0);

  const [showImportJumpDialog, setShowImportJumpDialog] = useState(false);
  const [isWaitingForJump, setIsWaitingForJump] = useState(false);
  const [importJumpTarget, setImportJumpTarget] = useState(0);
  const hasPromptedForImport = useRef(false);
  const metadataRef = useRef(null as unknown);

  // --- Setup useEpubReader Hook ---

  const readerOptions = useMemo<EpubReaderOptions>(() => ({
    viewMode,
    currentTheme,
    customTheme,
    fontFamily,
    fontSize,
    lineHeight,
    shouldForceFont,
    onLocationChange: (location, percentage, title, sectionId) => {
         if (!previousLocation.current) {
             previousLocation.current = {
                 start: location.start.cfi,
                 end: location.end.cfi,
                 timestamp: Date.now()
             };
         }

         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         const meta = metadataRef.current as any;
         if (meta && !meta.currentCfi && meta.progress > 0 && !hasPromptedForImport.current && id) {
             if (percentage < 0.01) {
                 setImportJumpTarget(meta.progress);
                 setShowImportJumpDialog(true);
                 hasPromptedForImport.current = true;
                 return;
             }
         }
         hasPromptedForImport.current = true;

         // Reading History Logic
         if (id && previousLocation.current) {
             const prevStart = previousLocation.current.start;
             const prevEnd = previousLocation.current.end;
             const duration = Date.now() - previousLocation.current.timestamp;
             const mode = viewMode;
             const isScroll = mode === 'scrolled';
             const shouldSave = isScroll ? duration > 2000 : true;

             if (prevStart && prevEnd && prevStart !== location.start.cfi && shouldSave) {
                 const currentBook = bookRef.current;
                 if (currentBook) {
                     Promise.all([
                         snapCfiToSentence(currentBook, prevStart),
                         snapCfiToSentence(currentBook, prevEnd)
                     ]).then(([snappedStart, snappedEnd]) => {
                         const range = generateCfiRange(snappedStart, snappedEnd);
                         const type = isScroll ? 'scroll' : 'page';
                         const label = currentSectionTitle || undefined;

                         dbService.updateReadingHistory(id, range, type, label)
                            .then(() => setHistoryTick(t => t + 1))
                            .catch((err) => {
                                console.error("History update failed", err);
                                useToastStore.getState().showToast('Failed to save reading history', 'error');
                            });
                     });
                 }
             }
         }
         previousLocation.current = {
             start: location.start.cfi,
             end: location.end.cfi,
             timestamp: Date.now()
         };

         updateLocationMetadata(title, sectionId);

         // Phase 2 Fix: Sync progress to Yjs (useProgressStore)
         if (id) {
             useProgressStore.setState((state) => {
                 const prev = state[id] || {
                     bookId: id,
                     percentage: 0,
                     lastRead: 0,
                     completedRanges: []
                 };
                 return {
                     ...state,
                     [id]: {
                         ...prev,
                         currentCfi: location.start.cfi,
                         percentage: percentage,
                         lastRead: Date.now()
                     }
                 };
             });
         }
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
        console.error("Reader Error:", msg);
    }
  }), [
    viewMode,
    currentTheme,
    customTheme,
    fontFamily,
    fontSize,
    lineHeight,
    shouldForceFont,
    id,
    updateLocationMetadata,
    setToc,
    showPopover,
    hidePopover,
    currentSectionTitle
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

  useEffect(() => {
      setIsLoading(hookLoading);
  }, [hookLoading, setIsLoading]);

  useEffect(() => {
    if (rendition) {
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
       (window as any).rendition = rendition;
    }
  }, [rendition]);

  useEffect(() => {
      if (hookError) {
          useToastStore.getState().showToast(hookError, 'error');
          if (hookError === 'Book file not found') {
              navigate('/');
          }
      }
  }, [hookError, navigate]);

  useEffect(() => {
    if (id) {
       AudioPlayerService.getInstance().setBookId(id);
       setCurrentBookId(id);
    }
  }, [id, setCurrentBookId]);

  useEffect(() => {
      return () => {
          if (id && previousLocation.current) {
             const prevStart = previousLocation.current.start;
             const prevEnd = previousLocation.current.end;
             if (prevStart && prevEnd) {
                 const range = generateCfiRange(prevStart, prevEnd);
                 const mode = viewMode;
                 const type = mode === 'scrolled' ? 'scroll' : 'page';
                 const label = currentSectionTitle || undefined;
                 dbService.updateReadingHistory(id, range, type, label).catch(console.error);
             }
          }
      };
  }, [id, viewMode, currentSectionTitle]);

  useEffect(() => {
      return () => {
          searchClient.terminate();
          reset();
          hidePopover();
      };
  }, [reset, hidePopover]);

  const handleClearSelection = useCallback(() => {
      const iframe = viewerRef.current?.querySelector('iframe');
      if (iframe && iframe.contentWindow) {
          iframe.contentWindow.getSelection()?.removeAllRanges();
      }
  }, []);

  const popoverVisible = useAnnotationStore(state => state.popover.visible);
  useEffect(() => {
      if (!popoverVisible) {
          handleClearSelection();
      }
  }, [popoverVisible, handleClearSelection]);

  useTTS();

  const handleJumpConfirm = async () => {
      if (areLocationsReady) {
          setShowImportJumpDialog(false);
          if (book && rendition) {
              try {
                  const cfi = book.locations.cfiFromPercentage(importJumpTarget);
                  if (cfi) {
                      await rendition.display(cfi);
                  }
              } catch (e) {
                  console.error("Jump failed", e);
                  useToastStore.getState().showToast('Failed to jump to location', 'error');
              }
          }
      } else {
          setIsWaitingForJump(true);
      }
  };

  const handleJumpCancel = () => {
      setShowImportJumpDialog(false);
      setIsWaitingForJump(false);
      // Explicitly save current position (0)
      if (id) {
          // TODO: Save progress 0
      }
  };

  useEffect(() => {
    if (isWaitingForJump && areLocationsReady && book && rendition) {
        try {
            const cfi = book.locations.cfiFromPercentage(importJumpTarget);
            if (cfi) {
                rendition.display(cfi);
                setIsWaitingForJump(false);
                setShowImportJumpDialog(false);
            }
        } catch (e) {
            console.error("Deferred jump failed", e);
            useToastStore.getState().showToast('Failed to jump to location', 'error');
            setIsWaitingForJump(false);
            setShowImportJumpDialog(false);
        }
    }
  }, [isWaitingForJump, areLocationsReady, book, rendition, importJumpTarget]);

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

  const addedAnnotations = useRef<Set<string>>(new Set());

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
      annotations.forEach(annotation => {
        if (annotation.bookId === id && !addedAnnotations.current.has(annotation.id)) {
           const className = annotation.color === 'yellow' ? 'highlight-yellow' :
               annotation.color === 'green' ? 'highlight-green' :
               annotation.color === 'blue' ? 'highlight-blue' :
               annotation.color === 'red' ? 'highlight-red' : 'highlight-yellow';

           try {
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               (rendition as any).annotations.add('highlight', annotation.cfiRange, {}, () => {
                }, className, getAnnotationStyles(annotation.color));
               addedAnnotations.current.add(annotation.id);
           } catch (e) {
               console.warn(`Failed to add annotation ${annotation.id}`, e);
           }
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__reader_added_annotations_count = addedAnnotations.current.size;
    }
  }, [annotations, isRenditionReady, rendition, id]);

  const showToast = useToastStore(state => state.showToast);

  useEffect(() => {
      if (lastError) {
          showToast(lastError, 'error');
          clearError();
      }
  }, [lastError, showToast, clearError]);

  const addedDebugHighlights = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!rendition || !isRenditionReady) return;

    if (!isDebugModeEnabled) {
        addedDebugHighlights.current.forEach(cfi => {
            try {
                // @ts-expect-error annotations is not typed fully
                rendition.annotations.remove(cfi, 'highlight');
            } catch (e) {
                console.warn("Failed to remove debug highlight", e);
            }
        });
        addedDebugHighlights.current.clear();
        return;
    }

    const applyHighlights = async () => {
        try {
            if (currentSectionId === undefined || !book) return;

            const section = book.spine.get(currentSectionId!);
            if (!section) return;

            const analysis = await dbService.getContentAnalysis(id!, section.href);
            if (!analysis) return;

            if (analysis.contentTypes) {
                const items = analysis.contentTypes;
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
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
                             console.warn("Failed to add debug highlight", e);
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Failed to apply debug highlights", e);
        }
    };

    applyHighlights();

  }, [rendition, isRenditionReady, isDebugModeEnabled, id, currentSectionId, book]);

  useEffect(() => {
      const addedRanges: string[] = [];
      if (rendition && isRenditionReady && id) {
          dbService.getReadingHistory(id).then(ranges => {
               ranges.forEach(range => {
                   try {
                       // eslint-disable-next-line @typescript-eslint/no-explicit-any
                       (rendition as any).annotations.add('highlight', range, {}, null, 'reading-history-highlight', { fill: 'gray', fillOpacity: '0.1', mixBlendMode: 'multiply' });
                       addedRanges.push(range);
                   } catch (e) {
                       console.warn("Failed to add history highlight", e);
                   }
               });
          });
      }

      return () => {
          if (rendition && addedRanges.length > 0) {
              addedRanges.forEach(range => {
                  try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (rendition as any).annotations.remove(range, 'highlight');
                  } catch (e) {
                      console.warn("Failed to remove history highlight", e);
                  }
              });
          }
      };
  }, [rendition, isRenditionReady, id]);

  const [useSyntheticToc, setUseSyntheticToc] = useState(false);
  const [syntheticToc, setSyntheticToc] = useState<NavigationItem[]>([]);

  const activeTocId = useMemo(() => {
      if (!currentSectionId) return null;
      let bestMatchId: string | null = null;

      const currentToc = useSyntheticToc ? syntheticToc : toc;

      const traverse = (items: NavigationItem[]): boolean => {
          for (const item of items) {
              const itemPath = item.href.split('#')[0];
              const sectionPath = currentSectionId.split('#')[0];

              if (itemPath === sectionPath) {
                   if (!bestMatchId) {
                       bestMatchId = item.id;
                   }
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

  const { enhanceTOC, isEnhancing, progress: tocProgress } = useSmartTOC(
      book,
      id,
      toc,
      setSyntheticToc
  );

  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [lexiconText] = useState('');

  const { setGlobalSettingsOpen } = useUIStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState(0);

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

  useEffect(() => {
      if (metadata?.syntheticToc) {
          setSyntheticToc(metadata.syntheticToc);
      } else {
          setSyntheticToc([]);
      }
  }, [metadata]);


  const handlePrev = useCallback(() => {
      rendition?.prev();
  }, [rendition]);

  const handleNext = useCallback(() => {
      rendition?.next();
  }, [rendition]);

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
              const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
              let node;
              while ((node = walker.nextNode())) {
                  if (node.textContent?.toLowerCase().includes(text.toLowerCase())) {
                      range = doc.createRange();
                      range.selectNodeContents(node);
                      element = node.parentElement;

                      const selection = iframe.contentWindow.getSelection();
                      selection?.removeAllRanges();
                      selection?.addRange(range);
                      break;
                  }
              }
          }

          if (element) {
              if (viewMode === 'scrolled') {
                 const wrapper = viewerRef.current?.firstElementChild as HTMLElement;
                 if (wrapper && wrapper.scrollHeight > wrapper.clientHeight) {
                     const rect = element.getBoundingClientRect();
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const selectionRange = (rendition as any).getRange(cfiRange);
          if (!selectionRange) return;

          let bestIndex = -1;
          for (let i = 0; i < queue.length; i++) {
              const item = queue[i];
              if (!item.cfi) continue;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const itemRange = (rendition as any).getRange(item.cfi);
              if (!itemRange) continue;

              const comparison = itemRange.compareBoundaryPoints(Range.START_TO_START, selectionRange);

              if (comparison <= 0) {
                  bestIndex = i;
              } else {
                  break;
              }
          }

          if (bestIndex !== -1) {
              AudioPlayerService.getInstance().jumpTo(bestIndex);
          }
      } catch (e) {
          console.error("Error matching CFI for playback", e);
      }
  }, [rendition]);

  useEffect(() => {
      setPlayFromSelection(handlePlayFromSelection);
      return () => setPlayFromSelection(undefined);
  }, [handlePlayFromSelection, setPlayFromSelection]);

  const renderTOCItem = (item: NavigationItem, index: number, level: number = 0, parentId: string = 'toc-item') => {
      const hasSubitems = item.subitems && item.subitems.length > 0;
      const showSubitems = hasSubitems && level < 2;

      const currentId = `${parentId}-${index}`;
      const isActive = item.id === activeTocId;

      return (
          <li key={item.id}>
             <button
                data-testid={currentId}
                className={cn(
                    "text-left w-full text-sm py-1 block truncate transition-colors",
                    isActive ? "text-primary font-medium bg-accent/50 rounded-md px-2 -ml-2" : "text-muted-foreground hover:text-primary"
                )}
                style={{ paddingLeft: `${level * 1.0 + (isActive ? 0.5 : 0)}rem` }}
                onClick={() => {
                    rendition?.display(item.href);
                    setSidebar('none');
                }}
             >
                 {item.label.trim()}
             </button>
             {showSubitems && (
                 <ul className="space-y-1 mt-1">
                     {item.subitems!.map((subitem, subIndex) => renderTOCItem(subitem, subIndex, level + 1, currentId))}
                 </ul>
             )}
          </li>
      );
  }

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
         viewMode={viewMode}
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
        <header className="flex items-center justify-between px-2 md:px-8 py-2 bg-surface shadow-sm z-10">
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
                data-testid="reader-settings-button"
                aria-label="Settings"
                onClick={() => setGlobalSettingsOpen(true)}
                className="rounded-full text-muted-foreground"
            >
                <Settings className="w-5 h-5" />
            </Button>
            </div>
        </header>
      )}

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex justify-center">
         {/* TOC Sidebar (now includes History) */}
         {showToc && (
             <div data-testid="reader-toc-sidebar" className="w-64 shrink-0 bg-surface border-r border-border z-50 absolute inset-y-0 left-0 md:static flex flex-col">
                 <Tabs defaultValue="chapters" className="w-full h-full flex flex-col">
                     <div className="p-4 pb-0">
                         <TabsList className="grid w-full grid-cols-2">
                             <TabsTrigger value="chapters" data-testid="tab-chapters">Chapters</TabsTrigger>
                             <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
                         </TabsList>
                     </div>

                     <TabsContent value="chapters" className="flex-1 overflow-y-auto mt-2 min-h-0">
                         <div className="p-4 pt-0">
                             <div className="flex flex-col gap-3 mb-4 mt-2">
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="synthetic-toc-mode"
                                        checked={useSyntheticToc}
                                        onCheckedChange={setUseSyntheticToc}
                                    />
                                    <Label htmlFor="synthetic-toc-mode" className="text-sm font-medium">Generated Titles</Label>
                                </div>

                                {useSyntheticToc && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="w-full text-xs"
                                        onClick={enhanceTOC}
                                        disabled={isEnhancing}
                                    >
                                        {isEnhancing ? (
                                           <span>Enhancing... {tocProgress ? `(${tocProgress.current}/${tocProgress.total})` : ''}</span>
                                        ) : (
                                           <>
                                             <Wand2 className="w-3 h-3 mr-2" />
                                             Enhance Titles with AI
                                           </>
                                        )}
                                    </Button>
                                )}
                             </div>

                             <ul className="space-y-2">
                                 {(useSyntheticToc ? syntheticToc : toc).map((item, index) => renderTOCItem(item, index))}
                                 {useSyntheticToc && syntheticToc.length === 0 && (
                                     <li className="text-sm text-muted-foreground">No generated titles available.</li>
                                 )}
                             </ul>
                         </div>
                     </TabsContent>

                     <TabsContent value="history" className="flex-1 overflow-y-auto mt-0 min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
                         <ReadingHistoryPanel
                            bookId={id || ''}
                            rendition={rendition}
                            trigger={historyTick}
                            onNavigate={(cfi) => {
                                rendition?.display(cfi);
                            }}
                         />
                     </TabsContent>
                 </Tabs>
             </div>
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
             <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-border">
                     <div className="flex items-center justify-between mb-2">
                        <h2 className="text-lg font-bold text-foreground">Search</h2>
                     </div>
                     <div className="flex gap-2">
                         <input
                            data-testid="search-input"
                            aria-label="Search query"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    setIsSearching(true);
                                    setActiveSearchQuery(searchQuery);
                                    searchClient.search(searchQuery, id || '').then(results => {
                                        setSearchResults(results);
                                        setIsSearching(false);
                                    });
                                }
                            }}
                            placeholder="Search in book..."
                            className="w-full text-sm p-2 border rounded bg-background text-foreground border-border"
                         />
                     </div>
                     {isIndexing && (
                        <div className="mt-3 space-y-1">
                             <div className="flex justify-between text-xs text-muted-foreground">
                                 <span>Indexing book...</span>
                                 <span>{indexingProgress}%</span>
                             </div>
                             <div className="h-1.5 bg-secondary rounded-full overflow-hidden w-full">
                                 <div
                                    className="h-full bg-primary transition-all duration-300 ease-in-out"
                                    style={{ width: `${indexingProgress}%` }}
                                 />
                             </div>
                        </div>
                     )}
                 </div>
                 <div className="flex-1 overflow-y-auto p-4">
                     {isSearching ? (
                         <div className="text-center text-muted-foreground">Searching...</div>
                     ) : (
                         <ul className="space-y-4">
                             {searchResults.map((result, idx) => (
                                 <li key={idx} className="border-b border-border pb-2 last:border-0">
                                     <button
                                        data-testid={`search-result-${idx}`}
                                        className="text-left w-full"
                                        onClick={async () => {
                                            if (rendition) {
                                                await rendition.display(result.href);
                                                // Small delay to ensure rendering is complete before searching DOM
                                                setTimeout(() => {
                                                    scrollToText(activeSearchQuery);
                                                }, 500);
                                            }
                                        }}
                                     >
                                         <p className="text-xs text-muted-foreground mb-1">Result {idx + 1}</p>
                                         <p className="text-sm text-foreground line-clamp-3">
                                             {result.excerpt}
                                         </p>
                                     </button>
                                 </li>
                             ))}
                             {searchResults.length === 0 && searchQuery && !isSearching && (
                                 <div className="text-center text-muted-foreground text-sm">No results found</div>
                             )}
                         </ul>
                     )}
                 </div>
             </div>
         )}

         {/* Reader Area */}
         <div className="flex-1 relative min-w-0 flex flex-col items-center">
            <div
                data-testid="reader-iframe-container"
                ref={viewerRef}
                className={`w-full max-w-2xl overflow-hidden px-6 md:px-8 transition-opacity duration-300 ${isPlaying && immersiveMode ? 'opacity-40' : 'opacity-100'}`}
                style={{ height: viewMode === 'paginated' ? 'calc(100% - 100px)' : '100%' }}
            />

             <LexiconManager open={lexiconOpen} onOpenChange={setLexiconOpen} initialTerm={lexiconText} />
         </div>
      </div>

      {/* Content Analysis Debug Legend */}
      <ContentAnalysisLegend rendition={rendition} />

    </div>
  );
};
