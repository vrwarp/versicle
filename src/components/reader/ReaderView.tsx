import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { type Book, type Rendition, type Location } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useUIStore } from '../../store/useUIStore';
import { useTTS } from '../../hooks/useTTS';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { AnnotationPopover } from './AnnotationPopover';
import { AnnotationList } from './AnnotationList';
import { LexiconManager } from './LexiconManager';
import { VisualSettings } from './VisualSettings';
import { GestureOverlay } from './GestureOverlay';
import { useToastStore } from '../../store/useToastStore';
import { Popover, PopoverTrigger } from '../ui/Popover';
import { Sheet, SheetTrigger } from '../ui/Sheet';
import { UnifiedAudioPanel } from './UnifiedAudioPanel';
import { dbService } from '../../db/DBService';
import { searchClient, type SearchResult } from '../../lib/search';
import { ChevronLeft, ChevronRight, List, Settings, ArrowLeft, X, Search, Highlighter, Maximize, Minimize, Type, Headphones } from 'lucide-react';
import { AudioPlayerService } from '../../lib/tts/AudioPlayerService';
import { useEpubReader } from '../../hooks/useEpubReader';

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

  // Reader Data State
  const [bookData, setBookData] = useState<ArrayBuffer | null>(null);
  const [initialLocation, setInitialLocation] = useState<string | undefined>(undefined);

  // Compatibility Refs (for listeners and existing logic)
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [isRenditionReady, setIsRenditionReady] = useState(false);

  const {
    currentTheme,
    customTheme,
    fontFamily,
    lineHeight,
    fontSize,
    updateLocation,
    setToc,
    setIsLoading,
    setCurrentBookId,
    reset,
    progress,
    currentChapterTitle,
    viewMode,
    shouldForceFont
  } = useReaderStore();

  const {
      isPlaying,
      status,
      play,
      activeCfi,
      lastError,
      clearError,
      queue
  } = useTTSStore();

  const {
    annotations,
    loadAnnotations,
    showPopover,
    hidePopover
  } = useAnnotationStore();

  // --- Data Fetching ---
  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
        setIsLoading(true);
        setCurrentBookId(id);
        AudioPlayerService.getInstance().setBookId(id);

        try {
            const { file, metadata } = await dbService.getBook(id);
            if (!file) {
                console.error('Book file not found');
                navigate('/');
                return;
            }
            setBookData(file);
            setInitialLocation(metadata?.currentCfi || undefined);
        } catch (err) {
            console.error('Error loading book data:', err);
            setIsLoading(false);
            navigate('/');
        }
    };

    fetchData();

    return () => {
        setBookData(null);
        setInitialLocation(undefined);
        reset();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  // --- EPUB Reader Hook ---
  const { book, rendition, isReady, error: readerError } = useEpubReader({
      viewerRef,
      source: bookData,
      viewMode
  });

  // Sync refs and Setup Logic
  useEffect(() => {
      bookRef.current = book;
      renditionRef.current = rendition;
      setIsRenditionReady(isReady);

      if (readerError) {
          console.error("EPUB Reader Error:", readerError);
          setIsLoading(false);
          // Could show toast here
      }

      // Initial Setup when Reader is Ready
      if (book && rendition && isReady) {
          const setup = async () => {
               try {
                   // 1. Navigation/TOC
                   const nav = await book.loaded.navigation;
                   setToc(nav.toc);

                   // 2. Register Themes (Initial)
                   // eslint-disable-next-line @typescript-eslint/no-explicit-any
                   const themes = rendition.themes as any;

                   themes.register('light', `
                    body { background: #ffffff !important; color: #000000 !important; }
                    p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
                    a { color: #0000ee !important; }
                   `);
                   themes.register('dark', `
                    body { background: #1a1a1a !important; color: #f5f5f5 !important; }
                    p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
                    a { color: #6ab0f3 !important; }
                   `);
                   themes.register('sepia', `
                    body { background: #f4ecd8 !important; color: #5b4636 !important; }
                    p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
                    a { color: #0000ee !important; }
                   `);
                   // Note: We use default values here, dynamic updates handled in separate effect
                   themes.register('custom', `
                    body { background: ${customTheme.bg} !important; color: ${customTheme.fg} !important; }
                    p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
                  `);

                   themes.select(currentTheme);
                   themes.fontSize(`${fontSize}%`);
                   themes.font(fontFamily);

                    // Register TTS highlight theme
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (rendition.themes as any).default({
                        '.tts-highlight': {
                            'fill': 'yellow',
                            'background-color': 'rgba(255, 255, 0, 0.3)',
                            'fill-opacity': '0.3',
                            'mix-blend-mode': 'multiply'
                        }
                    });

                    // Update line height
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (rendition.themes as any).default({
                        p: { 'line-height': `${lineHeight} !important` },
                        body: { 'line-height': `${lineHeight} !important` }
                    });

                   // 3. Display
                   await rendition.display(initialLocation);

                   // 4. Locations & Progress
                   await book.ready;

                   const updateProgressFromLocations = (r: Rendition, b: Book) => {
                       // eslint-disable-next-line @typescript-eslint/no-explicit-any
                       const currentLoc = (r as any).location;
                       if (currentLoc && currentLoc.start) {
                           const cfi = currentLoc.start.cfi;
                           let pct = 0;
                           try {
                               pct = b.locations.percentageFromCfi(cfi);
                           } catch {
                               // Ignore
                           }
                           // eslint-disable-next-line @typescript-eslint/no-explicit-any
                           const item = b.spine.get(currentLoc.start.href) as any;
                           const title = item ? (item.label || 'Chapter') : 'Unknown';
                           updateLocation(cfi, pct, title);
                           if (id) dbService.saveProgress(id, cfi, pct);
                       }
                   };

                   if (id) {
                       const savedLocations = await dbService.getLocations(id);
                       if (savedLocations) {
                           book.locations.load(savedLocations.locations);
                           updateProgressFromLocations(rendition, book);
                       } else {
                           book.locations.generate(1000).then(async () => {
                               const locationStr = book.locations.save();
                               await dbService.saveLocations(id, locationStr);
                               updateProgressFromLocations(rendition, book);
                           });
                       }
                   }

                   // 5. Index for Search
                   if (id) {
                       searchClient.indexBook(book, id).then(() => {
                           console.log("Book indexed for search");
                       });
                   }

                   // 6. Event Listeners
                   rendition.on('selected', (cfiRange: string) => {
                       // eslint-disable-next-line @typescript-eslint/no-explicit-any
                       const range = (rendition as any).getRange(cfiRange);
                       if (range) {
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
                       }
                   });

                   rendition.on('click', () => {
                        hidePopover();
                   });

                   rendition.on('relocated', (location: Location) => {
                        const cfi = location.start.cfi;
                        if (cfi === useReaderStore.getState().currentCfi) return;

                        hidePopover();
                        let percentage = 0;
                        try {
                            percentage = book.locations.percentageFromCfi(cfi);
                        } catch { /* ignore */ }

                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const item = book.spine.get(location.start.href) as any;
                        const title = item ? (item.label || 'Chapter') : 'Unknown';

                        updateLocation(cfi, percentage, title);
                        if (id) dbService.saveProgress(id, cfi, percentage);
                   });

                   setIsLoading(false);

               } catch (err) {
                   console.error("Error during book setup:", err);
                   setIsLoading(false);
               }
          };

          setup();
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, rendition, isReady, readerError, id]); // Intentionally omitting mutable/stable deps like initialLocation to avoid re-runs

  // Use TTS Hook
  useTTS(renditionRef.current);

  // Highlight Active TTS Sentence
  useEffect(() => {
      const rendition = renditionRef.current;
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
  }, [activeCfi, viewMode]);

  // Load Annotations
  useEffect(() => {
    if (id) {
      loadAnnotations(id);
    }
  }, [id, loadAnnotations]);

  // Apply Annotations to Rendition
  // We use a ref to track which annotations have been added to the rendition to avoid duplicates.
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
    const rendition = renditionRef.current;
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

      const currentIds = new Set(annotations.map(a => a.id));
      addedAnnotations.current.forEach(id => {
          if (!currentIds.has(id)) {
              // Should handle removal
          }
      });
    }
  }, [annotations, isRenditionReady]);

  // Handle TTS Errors
  const showToast = useToastStore(state => state.showToast);

  useEffect(() => {
      if (lastError) {
          showToast(lastError, 'error');
          clearError(); // Clear immediately so it doesn't persist in TTS store
      }
  }, [lastError, showToast, clearError]);

  // Apply Forced Theme Styles
  // Ref to store the current styles calculation function to be used by hook
  const applyStylesRef = useRef<() => void>(() => {});

  useEffect(() => {
    const applyStyles = () => {
      if (!renditionRef.current) return;

      const getStyles = () => {
        if (!shouldForceFont) return '';

        let bg, fg, linkColor;
        switch (currentTheme) {
          case 'dark':
            bg = '#1a1a1a'; fg = '#f5f5f5'; linkColor = '#6ab0f3';
            break;
          case 'sepia':
            bg = '#f4ecd8'; fg = '#5b4636'; linkColor = '#0000ee';
            break;
          case 'custom':
            bg = customTheme.bg; fg = customTheme.fg; linkColor = customTheme.fg;
            break;
          default: // light
            bg = '#ffffff'; fg = '#000000'; linkColor = '#0000ee';
        }

        return `
          html body *, html body p, html body div, html body span, html body h1, html body h2, html body h3, html body h4, html body h5, html body h6 {
            font-family: ${fontFamily} !important;
            line-height: ${lineHeight} !important;
            color: ${fg} !important;
            background-color: transparent !important;
            text-align: left !important;
          }
          html, body {
            background: ${bg} !important;
          }
          a, a * {
            color: ${linkColor} !important;
            text-decoration: none !important;
          }
          a:hover, a:hover * {
            text-decoration: underline !important;
          }
        `;
      };

      const css = getStyles();

      // Apply to active contents
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (renditionRef.current as any).getContents().forEach((content: any) => {
        const doc = content.document;
        let style = doc.getElementById('force-theme-style');
        if (!style) {
          style = doc.createElement('style');
          style.id = 'force-theme-style';
          doc.head.appendChild(style);
        }
        style.textContent = css;
      });
    };

    applyStylesRef.current = applyStyles;
    applyStyles();
  }, [shouldForceFont, currentTheme, customTheme, fontFamily, lineHeight, isRenditionReady]);

  // Register hook to apply styles on new content load
  useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hook = (content: any) => {
          const doc = content.document;
          if (!doc.getElementById('force-theme-style')) {
              const style = doc.createElement('style');
              style.id = 'force-theme-style';
              doc.head.appendChild(style);

              // Apply current styles immediately
              applyStylesRef.current();
          }

          // Re-attach manual selection listener
           const docEl = content.document;
           docEl.addEventListener('mouseup', () => {
               const selection = content.window.getSelection();
               if (!selection || selection.isCollapsed) return;
               setTimeout(() => {
                   const range = selection.getRangeAt(0);
                   if (!range) return;
                   const cfi = content.cfiFromRange(range);
                   if (cfi) {
                        const rect = range.getBoundingClientRect();
                        const iframe = viewerRef.current?.querySelector('iframe');
                        if (iframe) {
                            const iframeRect = iframe.getBoundingClientRect();
                            showPopover(
                                rect.left + iframeRect.left,
                                rect.top + iframeRect.top,
                                cfi,
                                range.toString()
                            );
                        }
                   }
               }, 10);
           });
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition.hooks.content as any).register(hook);

      return () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition.hooks.content as any).deregister(hook);
      };
  }, [rendition, isRenditionReady]); // Only run when rendition becomes ready/changes

  // Handle Standard Theme/Font/Layout changes (via epub.js themes)
  useEffect(() => {
    if (renditionRef.current) {
      // Standard non-forced themes (Strings to avoid epub.js object registration bugs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const themes = renditionRef.current.themes as any;

      themes.register('light', `
        body { background: #ffffff !important; color: #000000 !important; }
        p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
        a { color: #0000ee !important; }
      `);
      themes.register('dark', `
        body { background: #1a1a1a !important; color: #f5f5f5 !important; }
        p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
        a { color: #6ab0f3 !important; }
      `);
      themes.register('sepia', `
        body { background: #f4ecd8 !important; color: #5b4636 !important; }
        p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
        a { color: #0000ee !important; }
      `);
      themes.register('custom', `
        body { background: ${customTheme.bg} !important; color: ${customTheme.fg} !important; }
        p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
        a { color: ${customTheme.fg} !important; }
      `);

      themes.select(currentTheme);
      renditionRef.current.themes.fontSize(`${fontSize}%`);
      renditionRef.current.themes.font(fontFamily);

      // Update line height
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (renditionRef.current.themes as any).default({
        p: { 'line-height': `${lineHeight} !important` },
        body: { 'line-height': `${lineHeight} !important` }
      });
    }
  }, [currentTheme, customTheme, fontSize, fontFamily, lineHeight, isRenditionReady]);

  // Handle View Mode changes - already handled in hook, but we might need to re-display
  useEffect(() => {
      if (renditionRef.current) {
          // Re-display current location to ensure proper rendering after flow change
          const currentLoc = useReaderStore.getState().currentCfi;
          if (currentLoc) {
              renditionRef.current.display(currentLoc);
          }
      }
  }, [viewMode]);

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
      renditionRef.current?.prev();
  };
  const handleNext = () => {
      console.log("Navigating to next page");
      if (status === 'playing' || status === 'loading') {
          setAutoPlayNext(true);
      }
      renditionRef.current?.next();
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
      if (autoPlayNext && status === 'stopped' && queue.length > 0) {
          play();
          setAutoPlayNext(false);
      }
  }, [status, autoPlayNext, play, queue]);

  // Handle Container Resize
  const prevSize = useRef({ width: 0, height: 0 });
  const resizeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    const observer = new ResizeObserver((entries) => {
        if (!renditionRef.current || !entries.length) return;

        const { width, height } = entries[0].contentRect;

        if (Math.abs(prevSize.current.width - width) > 1 || Math.abs(prevSize.current.height - height) > 1) {
            prevSize.current = { width, height };

            if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
            resizeTimeout.current = setTimeout(() => {
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 (renditionRef.current as any)?.resize(width, height);
            }, 100);
        }
    });

    observer.observe(viewerRef.current);

    return () => {
        observer.disconnect();
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        const { status, currentIndex, jumpTo } = useTTSStore.getState();
        if (status === 'playing' || status === 'paused') {
          if (currentIndex > 0) jumpTo(currentIndex - 1);
        } else {
          handlePrev();
        }
      }
      if (e.key === 'ArrowRight') {
        const { status, currentIndex, queue, jumpTo } = useTTSStore.getState();
        if (status === 'playing' || status === 'paused') {
          if (currentIndex < queue.length - 1) jumpTo(currentIndex + 1);
        } else {
          handleNext();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { gestureMode, setGestureMode } = useReaderStore();

  // Close Audio Panel when Gesture Mode is enabled
  useEffect(() => {
      if (gestureMode) {
          setAudioPanelOpen(false);
      }
  }, [gestureMode]);

  const [showToc, setShowToc] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [lexiconText, setLexiconText] = useState('');
  const { setGlobalSettingsOpen } = useUIStore();
  const [audioPanelOpen, setAudioPanelOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground relative">
      <GestureOverlay
          onNextChapter={handleNext}
          onPrevChapter={handlePrev}
          onClose={() => setGestureMode(false)}
      />

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

      <div className="flex-1 relative overflow-hidden flex justify-center">
         {showToc && (
             <div data-testid="reader-toc-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static">
                 <div className="p-4">
                     <h2 className="text-lg font-bold mb-4 text-foreground">Contents</h2>
                     <ul className="space-y-2">
                         {useReaderStore.getState().toc.map((item, index) => (
                             <li key={item.id}>
                                 <button
                                    data-testid={`toc-item-${index}`}
                                    className="text-left w-full text-sm text-muted-foreground hover:text-primary"
                                    onClick={() => {
                                        renditionRef.current?.display(item.href);
                                        setShowToc(false);
                                    }}
                                 >
                                     {item.label}
                                 </button>
                             </li>
                         ))}
                     </ul>
                 </div>
             </div>
         )}

         {showAnnotations && (
             <div data-testid="reader-annotations-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-border">
                     <h2 className="text-lg font-bold text-foreground">Annotations</h2>
                 </div>
                 <AnnotationList onNavigate={(cfi) => {
                     renditionRef.current?.display(cfi);
                     if (window.innerWidth < 768) setShowAnnotations(false);
                 }} />
             </div>
         )}

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
                                            if (renditionRef.current) {
                                                await renditionRef.current.display(result.href);
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
