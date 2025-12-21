import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { NavigationItem } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { useShallow } from 'zustand/react/shallow';
import { useTTSStore } from '../../store/useTTSStore';
import { useUIStore } from '../../store/useUIStore';
import { useTTS } from '../../hooks/useTTS';
import { useEpubReader, type EpubReaderOptions } from '../../hooks/useEpubReader';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { AnnotationPopover } from './AnnotationPopover';
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
import { generateCfiRange } from '../../lib/cfi-utils';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { Button } from '../ui/Button';
import { useSmartTOC } from '../../hooks/useSmartTOC';
import { Wand2 } from 'lucide-react';
import { cn } from '../../lib/utils';

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
  const viewerRef = useRef<HTMLDivElement>(null);
  const previousLocation = useRef<{ start: string; end: string; timestamp: number } | null>(null);

  const {
    currentTheme,
    customTheme,
    fontFamily,
    lineHeight,
    fontSize,
    updateLocation,
    toc,
    setToc,
    setIsLoading,
    setCurrentBookId,
    reset,
    currentChapterTitle,
    viewMode,
    shouldForceFont,
    immersiveMode,
    setImmersiveMode
  } = useReaderStore(useShallow(state => ({
    currentTheme: state.currentTheme,
    customTheme: state.customTheme,
    fontFamily: state.fontFamily,
    lineHeight: state.lineHeight,
    fontSize: state.fontSize,
    updateLocation: state.updateLocation,
    toc: state.toc,
    setToc: state.setToc,
    setIsLoading: state.setIsLoading,
    setCurrentBookId: state.setCurrentBookId,
    reset: state.reset,
    currentChapterTitle: state.currentChapterTitle,
    viewMode: state.viewMode,
    shouldForceFont: state.shouldForceFont,
    immersiveMode: state.immersiveMode,
    setImmersiveMode: state.setImmersiveMode
  })));

  // Optimization: Select only necessary state to prevent re-renders on every activeCfi/currentIndex change
  const isPlaying = useTTSStore(state => state.isPlaying);
  const status = useTTSStore(state => state.status);
  const play = useTTSStore(state => state.play);
  const queue = useTTSStore(state => state.queue);
  const lastError = useTTSStore(state => state.lastError);
  const clearError = useTTSStore(state => state.clearError);

  const {
    annotations,
    loadAnnotations,
    showPopover,
    hidePopover
  } = useAnnotationStore();

  const [historyTick, setHistoryTick] = useState(0);

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
         // Initialize previousLocation if it's null (e.g. initial load), so we can track subsequent moves
         if (!previousLocation.current) {
             previousLocation.current = {
                 start: location.start.cfi,
                 end: location.end.cfi,
                 timestamp: Date.now()
             };
         }

         // Prevent infinite loop if CFI hasn't changed (handled in store usually, but double check)
         if (location.start.cfi === useReaderStore.getState().currentCfi) return;

         // Reading History
         if (id && previousLocation.current) {
             const prevStart = previousLocation.current.start;
             const prevEnd = previousLocation.current.end;
             const duration = Date.now() - previousLocation.current.timestamp;

             // console.log(`[History] Check: prev=${prevStart}, curr=${location.start.cfi}, dur=${duration}`);

             // Ensure we don't save zero-length ranges (where start == current start)
             // And enforce a Dwell Time of 2 seconds to avoid recording skips
             if (prevStart && prevEnd && prevStart !== location.start.cfi && duration > 2000) {
                 const range = generateCfiRange(prevStart, prevEnd);
                 // console.log(`[History] Saving range: ${range}`);
                 dbService.updateReadingHistory(id, range)
                    .then(() => setHistoryTick(t => t + 1))
                    .catch((err) => {
                        console.error("History update failed", err);
                        useToastStore.getState().showToast('Failed to save reading history', 'error');
                    });
             }
         }
         previousLocation.current = {
             start: location.start.cfi,
             end: location.end.cfi,
             timestamp: Date.now()
         };

         updateLocation(location.start.cfi, percentage, title, sectionId);
         if (id) {
             dbService.saveProgress(id, location.start.cfi, percentage);
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
    onBookLoaded: (book) => {
         if (id) {
            // Index for Search (Async)
            searchClient.indexBook(book, id).then(() => {
                // console.log("Book indexed for search");
            });
         }
    },
    onClick: () => hidePopover(),
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
    updateLocation,
    setToc,
    showPopover,
    hidePopover
  ]);

  const {
      rendition,
      book,
      isReady: isRenditionReady,
      isLoading: hookLoading,
      metadata,
      error: hookError
  } = useEpubReader(id, viewerRef, readerOptions);

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
             if (prevStart && prevEnd) {
                 const range = generateCfiRange(prevStart, prevEnd);
                 dbService.updateReadingHistory(id, range).catch(console.error);
             }
          }
      };
  }, [id]);

  // Handle Unmount Cleanup
  useEffect(() => {
      return () => {
          searchClient.terminate();
          reset();
      };
  }, [reset]);


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
      annotations.forEach(annotation => {
        if (!addedAnnotations.current.has(annotation.id)) {
           const className = annotation.color === 'yellow' ? 'highlight-yellow' :
               annotation.color === 'green' ? 'highlight-green' :
               annotation.color === 'blue' ? 'highlight-blue' :
               annotation.color === 'red' ? 'highlight-red' : 'highlight-yellow';

           try {
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               (rendition as any).annotations.add('highlight', annotation.cfiRange, {}, () => {
                    // console.log("Clicked annotation", annotation.id);
                }, className, getAnnotationStyles(annotation.color));
               addedAnnotations.current.add(annotation.id);
           } catch (e) {
               console.warn(`Failed to add annotation ${annotation.id}`, e);
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

  // Reading History Highlights
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


  const [showToc, setShowToc] = useState(false);
  const [useSyntheticToc, setUseSyntheticToc] = useState(false);
  const [syntheticToc, setSyntheticToc] = useState<NavigationItem[]>([]);
  const [showAnnotations, setShowAnnotations] = useState(false);

  // Smart TOC Hook
  const { enhanceTOC, isEnhancing, progress: tocProgress } = useSmartTOC(
      book,
      id,
      toc,
      setSyntheticToc
  );

  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [lexiconText, setLexiconText] = useState('');

  const { setGlobalSettingsOpen } = useUIStore();
  const [audioPanelOpen, setAudioPanelOpen] = useState(false);

  // Search State
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Load synthetic TOC from metadata
  useEffect(() => {
      if (metadata?.syntheticToc) {
          setSyntheticToc(metadata.syntheticToc);
      } else {
          setSyntheticToc([]);
      }
  }, [metadata]);

  const handleClearSelection = () => {
      const iframe = viewerRef.current?.querySelector('iframe');
      if (iframe && iframe.contentWindow) {
          iframe.contentWindow.getSelection()?.removeAllRanges();
      }
  };

  const [autoPlayNext, setAutoPlayNext] = useState(false);

  const handlePrev = useCallback(() => {
      // console.log("Navigating to previous page");
      if (status === 'playing' || status === 'loading') {
          setAutoPlayNext(true);
      }
      rendition?.prev();
  }, [status, rendition]);

  const handleNext = useCallback(() => {
      // console.log("Navigating to next page");
      if (status === 'playing' || status === 'loading') {
          setAutoPlayNext(true);
      }
      rendition?.next();
  }, [status, rendition]);

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
              if (viewMode === 'scrolled') {
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

  // Auto-advance chapter when TTS completes
  useEffect(() => {
      if (status === 'completed') {
          setAutoPlayNext(true);
          handleNext();
      }
  }, [status, handleNext]);

  // Trigger auto-play when new chapter loads (queue changes)
  useEffect(() => {
      // Check if we are waiting to auto-play and the player is stopped (meaning new queue loaded)
      // We also check queue length to ensure we actually have content
      if (autoPlayNext && status === 'stopped' && queue.length > 0) {
          play();
          setAutoPlayNext(false);
      }
  }, [status, autoPlayNext, play, queue]);

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
          console.error("Error matching CFI for playback", e);
      }
  }, [rendition]);

  return (
    <div data-testid="reader-view" className="flex flex-col h-screen bg-background text-foreground relative">
      <ReaderTTSController
         rendition={rendition}
         viewMode={viewMode}
         onPrev={handlePrev}
         onNext={handleNext}
      />

      {/* Unified Input Controller (Flow Mode) */}
      <UnifiedInputController
          rendition={rendition}
          currentChapterTitle={currentChapterTitle || ''}
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
                aria-label="Back"
                onClick={() => navigate('/')}
                className="rounded-full text-muted-foreground"
            >
                <ArrowLeft className="w-5 h-5" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                data-testid="reader-toc-button"
                aria-label="Table of Contents"
                onClick={() => { setShowToc(!showToc); setShowAnnotations(false); setShowSearch(false); }}
                className={cn("rounded-full text-muted-foreground", showToc && "bg-accent text-accent-foreground")}
            >
                <List className="w-5 h-5" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                data-testid="reader-annotations-button"
                aria-label="Annotations"
                onClick={() => { setShowAnnotations(!showAnnotations); setShowToc(false); setShowSearch(false); }}
                className={cn("rounded-full text-muted-foreground", showAnnotations && "bg-accent text-accent-foreground")}
            >
                <Highlighter className="w-5 h-5" />
            </Button>
            <Button
                variant="ghost"
                size="icon"
                data-testid="reader-search-button"
                aria-label="Search"
                onClick={() => { setShowSearch(!showSearch); setShowToc(false); setShowAnnotations(false); }}
                className="rounded-full text-muted-foreground"
            >
                    <Search className="w-5 h-5" />
            </Button>
            </div>
            <h1 className="text-sm font-medium truncate max-w-xs text-foreground hidden md:block">
                {currentChapterTitle || 'Reading'}
            </h1>
            <div className="flex items-center gap-1 md:gap-2">
            <Sheet open={audioPanelOpen} onOpenChange={setAudioPanelOpen}>
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
            <Popover>
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
                                 {(useSyntheticToc ? syntheticToc : toc).map((item, index) => (
                                     <li key={item.id}>
                                         <button
                                            data-testid={`toc-item-${index}`}
                                            className="text-left w-full text-sm text-muted-foreground hover:text-primary"
                                            onClick={() => {
                                                rendition?.display(item.href);
                                                setShowToc(false);
                                            }}
                                         >
                                             {item.label}
                                         </button>
                                     </li>
                                 ))}
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
                                setShowToc(false);
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
                     if (window.innerWidth < 768) setShowAnnotations(false);
                 }} />
             </div>
         )}

         {/* Search Sidebar */}
         {showSearch && (
             <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-border">
                     <h2 className="text-lg font-bold mb-2 text-foreground">Search</h2>
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
                            className="flex-1 text-sm p-2 border rounded bg-background text-foreground border-border"
                         />
                         <button
                            data-testid="search-close-button"
                            aria-label="Close search"
                            onClick={() => setShowSearch(false)}
                            className="p-2 hover:bg-border rounded"
                         >
                            <X className="w-4 h-4 text-muted-foreground" />
                         </button>
                     </div>
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
                className={`w-full max-w-2xl overflow-hidden px-6 md:px-8 transition-opacity duration-300 ${isPlaying ? 'opacity-85' : 'opacity-100'}`}
                style={{ height: viewMode === 'paginated' ? 'calc(100% - 100px)' : '100%' }}
            />

             <AnnotationPopover
                bookId={id || ''}
                onClose={handleClearSelection}
                onFixPronunciation={(text) => {
                    setLexiconText(text);
                    setLexiconOpen(true);
                }}
                onPlayFromSelection={handlePlayFromSelection}
             />
             <LexiconManager open={lexiconOpen} onOpenChange={setLexiconOpen} initialTerm={lexiconText} />
         </div>
      </div>

    </div>
  );
};
