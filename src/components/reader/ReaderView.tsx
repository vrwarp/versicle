import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { NavigationItem } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useUIStore } from '../../store/useUIStore';
import { useTTS } from '../../hooks/useTTS';
import { useEpubReader, type EpubReaderOptions } from '../../hooks/useEpubReader';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { AnnotationPopover } from './AnnotationPopover';
import { AnnotationList } from './AnnotationList';
import { LexiconManager } from './LexiconManager';
import { VisualSettings } from './VisualSettings';
import { GestureOverlay } from './GestureOverlay';
import { useToastStore } from '../../store/useToastStore';
import { Popover, PopoverTrigger } from '../ui/Popover';
import { Sheet, SheetTrigger } from '../ui/Sheet';
import { Switch } from '../ui/Switch';
import { Label } from '../ui/Label';
import { UnifiedAudioPanel } from './UnifiedAudioPanel';
import { dbService } from '../../db/DBService';
import { searchClient, type SearchResult } from '../../lib/search';
import { ChevronLeft, ChevronRight, List, Settings, ArrowLeft, X, Search, Highlighter, Maximize, Minimize, Type, Headphones } from 'lucide-react';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';

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
    progress,
    currentChapterTitle,
    viewMode,
    shouldForceFont,
    gestureMode,
    setGestureMode
  } = useReaderStore();

  const {
      isPlaying,
      status,
      play,
      activeCfi,
      lastError,
      clearError,
      queue,
      jumpTo,
      currentIndex
  } = useTTSStore();

  const {
    annotations,
    loadAnnotations,
    showPopover,
    hidePopover
  } = useAnnotationStore();

  // --- Setup useEpubReader Hook ---

  const readerOptions = useMemo<EpubReaderOptions>(() => ({
    viewMode,
    currentTheme,
    customTheme,
    fontFamily,
    fontSize,
    lineHeight,
    shouldForceFont,
    onLocationChange: (location, percentage, title) => {
         // Prevent infinite loop if CFI hasn't changed (handled in store usually, but double check)
         if (location.start.cfi === useReaderStore.getState().currentCfi) return;

         updateLocation(location.start.cfi, percentage, title);
         if (id) {
             dbService.saveProgress(id, location.start.cfi, percentage);
         }
    },
    onTocLoaded: (newToc) => setToc(newToc),
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
                console.log("Book indexed for search");
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
      isReady: isRenditionReady,
      isLoading: hookLoading,
      metadata,
      error: hookError
  } = useEpubReader(id, viewerRef, readerOptions);

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
    if (id) {
       AudioPlayerService.getInstance().setBookId(id);
       setCurrentBookId(id);
    }
  }, [id, setCurrentBookId]);

  // Handle Unmount Cleanup
  useEffect(() => {
      return () => {
          searchClient.terminate();
          reset();
      };
  }, [reset]);


  // Use TTS Hook
  useTTS(rendition);

  // Highlight Active TTS Sentence
  useEffect(() => {
      if (!rendition || !activeCfi) return;

      // Auto-turn page in paginated mode
      if (viewMode === 'paginated') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition as any).display(activeCfi);
      }

      // Add highlight
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition as any).annotations.add('highlight', activeCfi, {}, () => {
          // Click handler for TTS highlight
      }, 'tts-highlight');

      // Remove highlight when activeCfi changes
      return () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition as any).annotations.remove(activeCfi, 'highlight');
      };
  }, [activeCfi, viewMode, rendition]);

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

           // eslint-disable-next-line @typescript-eslint/no-explicit-any
           (rendition as any).annotations.add('highlight', annotation.cfiRange, {}, () => {
                console.log("Clicked annotation", annotation.id);
            }, className, getAnnotationStyles(annotation.color));
           addedAnnotations.current.add(annotation.id);
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


  const [showToc, setShowToc] = useState(false);
  const [useSyntheticToc, setUseSyntheticToc] = useState(false);
  const [syntheticToc, setSyntheticToc] = useState<NavigationItem[]>([]);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);

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

  const handlePrev = () => {
      console.log("Navigating to previous page");
      if (status === 'playing' || status === 'loading') {
          setAutoPlayNext(true);
      }
      rendition?.prev();
  };
  const handleNext = () => {
      console.log("Navigating to next page");
      if (status === 'playing' || status === 'loading') {
          setAutoPlayNext(true);
      }
      rendition?.next();
  };

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

  const [autoPlayNext, setAutoPlayNext] = useState(false);

  // Auto-advance chapter when TTS completes
  useEffect(() => {
      if (status === 'completed') {
          setAutoPlayNext(true);
          handleNext();
      }
  }, [status]);

  // Trigger auto-play when new chapter loads (queue changes)
  useEffect(() => {
      // Check if we are waiting to auto-play and the player is stopped (meaning new queue loaded)
      // We also check queue length to ensure we actually have content
      if (autoPlayNext && status === 'stopped' && queue.length > 0) {
          play();
          setAutoPlayNext(false);
      }
  }, [status, autoPlayNext, play, queue]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        if (status === 'playing' || status === 'paused') {
          if (currentIndex > 0) jumpTo(currentIndex - 1);
        } else {
          handlePrev();
        }
      }
      if (e.key === 'ArrowRight') {
        if (status === 'playing' || status === 'paused') {
          if (currentIndex < queue.length - 1) jumpTo(currentIndex + 1);
        } else {
          handleNext();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status, currentIndex, queue, jumpTo, rendition]); // Updated deps

  // Close Audio Panel when Gesture Mode is enabled
  useEffect(() => {
      if (gestureMode) {
          setAudioPanelOpen(false);
      }
  }, [gestureMode]);

  return (
    <div data-testid="reader-view" className="flex flex-col h-screen bg-background text-foreground relative">
      {/* Gesture Overlay */}
      <GestureOverlay
          onNextChapter={handleNext}
          onPrevChapter={handlePrev}
          onClose={() => setGestureMode(false)}
      />

      {/* Immersive Mode Exit Button */}
      {immersiveMode && (
        <button
            data-testid="reader-immersive-exit-button"
            aria-label="Exit Immersive Mode"
            onClick={() => setImmersiveMode(false)}
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-surface/50 hover:bg-surface shadow-md backdrop-blur-sm transition-colors"
        >
            <Minimize className="w-5 h-5 text-foreground" />
        </button>
      )}

      {/* Header */}
      {!immersiveMode && (
        <header className="flex items-center justify-between px-6 md:px-8 py-2 bg-surface shadow-sm z-10">
            <div className="flex items-center gap-2">
            <button data-testid="reader-back-button" aria-label="Back" onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-border">
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
            <button data-testid="reader-toc-button" aria-label="Table of Contents" onClick={() => { setShowToc(!showToc); setShowAnnotations(false); }} className={`p-2 rounded-full hover:bg-border ${showToc ? 'bg-border' : ''}`}>
                <List className="w-5 h-5 text-muted-foreground" />
            </button>
            <button data-testid="reader-annotations-button" aria-label="Annotations" onClick={() => { setShowAnnotations(!showAnnotations); setShowToc(false); }} className={`p-2 rounded-full hover:bg-border ${showAnnotations ? 'bg-border' : ''}`}>
                <Highlighter className="w-5 h-5 text-muted-foreground" />
            </button>
            <button data-testid="reader-search-button" aria-label="Search" onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-full hover:bg-border">
                    <Search className="w-5 h-5 text-muted-foreground" />
            </button>
            </div>
            <h1 className="text-sm font-medium truncate max-w-xs text-foreground">
                {currentChapterTitle || 'Reading'}
            </h1>
            <div className="flex items-center gap-2">
            <Sheet open={audioPanelOpen} onOpenChange={setAudioPanelOpen}>
                <SheetTrigger asChild>
                    <button data-testid="reader-audio-button" aria-label="Open Audio Deck" className={`p-2 rounded-full hover:bg-border ${isPlaying ? 'text-primary' : 'text-muted-foreground'}`}>
                        <Headphones className="w-5 h-5" />
                    </button>
                </SheetTrigger>
                <UnifiedAudioPanel />
            </Sheet>
            <button data-testid="reader-immersive-enter-button" aria-label="Enter Immersive Mode" onClick={() => setImmersiveMode(true)} className="p-2 rounded-full hover:bg-border">
                <Maximize className="w-5 h-5 text-muted-foreground" />
            </button>
            <Popover>
                <PopoverTrigger asChild>
                    <button data-testid="reader-visual-settings-button" aria-label="Visual Settings" className="p-2 rounded-full hover:bg-border">
                        <Type className="w-5 h-5 text-muted-foreground" />
                    </button>
                </PopoverTrigger>
                <VisualSettings />
            </Popover>
            <button data-testid="reader-settings-button" aria-label="Settings" onClick={() => setGlobalSettingsOpen(true)} className="p-2 rounded-full hover:bg-border">
                <Settings className="w-5 h-5 text-muted-foreground" />
            </button>
            </div>
        </header>
      )}

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex justify-center">
         {/* TOC Sidebar */}
         {showToc && (
             <div data-testid="reader-toc-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static">
                 <div className="p-4">
                     <h2 className="text-lg font-bold mb-4 text-foreground">Contents</h2>

                     <div className="flex items-center space-x-2 mb-4">
                        <Switch
                            id="synthetic-toc-mode"
                            checked={useSyntheticToc}
                            onCheckedChange={setUseSyntheticToc}
                        />
                        <Label htmlFor="synthetic-toc-mode" className="text-sm font-medium">Generated Titles</Label>
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
             </div>
         )}

         {/* Annotations Sidebar */}
         {showAnnotations && (
             <div data-testid="reader-annotations-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col">
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
             <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-border">
                     <h2 className="text-lg font-bold mb-2 text-foreground">Search</h2>
                     <div className="flex gap-2">
                         <input
                            data-testid="search-input"
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
            <div data-testid="reader-iframe-container" ref={viewerRef} className="w-full max-w-2xl h-full overflow-hidden px-6 md:px-8" />

             <AnnotationPopover
                bookId={id || ''}
                onClose={handleClearSelection}
                onFixPronunciation={(text) => {
                    setLexiconText(text);
                    setLexiconOpen(true);
                }}
             />
             <LexiconManager open={lexiconOpen} onOpenChange={setLexiconOpen} initialTerm={lexiconText} />
         </div>
      </div>

      {/* Footer / Controls */}
      {!immersiveMode && (
        <footer className="bg-surface border-t border-border px-6 md:px-8 py-2 flex items-center justify-between z-10">
            <button data-testid="reader-prev-page" aria-label="Previous Page" onClick={handlePrev} className="p-2 hover:bg-border rounded-full">
                <ChevronLeft className="w-6 h-6 text-muted-foreground" />
            </button>

            <div className="flex-1 mx-4">
                <div className="h-1 bg-border rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
                <div className="text-center text-xs text-muted-foreground mt-1">
                    {Math.round(progress * 100)}%
                </div>
            </div>

            <button data-testid="reader-next-page" aria-label="Next Page" onClick={handleNext} className="p-2 hover:bg-border rounded-full">
                <ChevronRight className="w-6 h-6 text-muted-foreground" />
            </button>
        </footer>
      )}
    </div>
  );
};
