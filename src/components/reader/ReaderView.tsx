import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub, { type Book, type Rendition, type Location } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useTTS } from '../../hooks/useTTS';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { AnnotationPopover } from './AnnotationPopover';
import { AnnotationList } from './AnnotationList';
import { ReaderSettings } from './ReaderSettings';
import { TTSCostIndicator } from './TTSCostIndicator';
import { TTSQueue } from './TTSQueue';
import { getDB } from '../../db/db';
import { searchClient, type SearchResult } from '../../lib/search';
import { ChevronLeft, ChevronRight, List, Settings, ArrowLeft, Play, Pause, X, Search, Highlighter } from 'lucide-react';

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

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

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
    currentChapterTitle
  } = useReaderStore();

  const {
      isPlaying,
      play,
      pause,
      activeCfi,
      rate,
      setRate,
      voice,
      setVoice,
      voices: availableVoices,
      providerId,
      setProviderId,
      apiKeys,
      setApiKey
  } = useTTSStore();

  const {
    annotations,
    loadAnnotations,
    showPopover,
    hidePopover
  } = useAnnotationStore();

  // Use TTS Hook
  const { sentences } = useTTS(renditionRef.current);

  // Highlight Active TTS Sentence
  useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition || !activeCfi) return;

      // Add highlight
      rendition.annotations.add('highlight', activeCfi, {}, () => {
          // Click handler for TTS highlight
      }, 'tts-highlight');

      // Remove highlight when activeCfi changes
      return () => {
          rendition.annotations.remove(activeCfi, 'highlight');
      };
  }, [activeCfi]);

  // Load Annotations
  useEffect(() => {
    if (id) {
      loadAnnotations(id);
    }
  }, [id, loadAnnotations]);

  // Apply Annotations to Rendition
  // We use a ref to track which annotations have been added to the rendition to avoid duplicates.
  const addedAnnotations = useRef<Set<string>>(new Set());

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) {
      // Add new annotations
      annotations.forEach(annotation => {
        if (!addedAnnotations.current.has(annotation.id)) {
           rendition.annotations.add('highlight', annotation.cfiRange, {}, () => {
                console.log("Clicked annotation", annotation.id);
                // TODO: Open edit/delete menu, perhaps via a new state/popover
            }, annotation.color === 'yellow' ? 'highlight-yellow' :
               annotation.color === 'green' ? 'highlight-green' :
               annotation.color === 'blue' ? 'highlight-blue' :
               annotation.color === 'red' ? 'highlight-red' : 'highlight-yellow');
           addedAnnotations.current.add(annotation.id);
        }
      });

      // Handle removals (if annotations were deleted from store)
      // This requires iterating over addedAnnotations and checking if they exist in `annotations`
      // For now, since `epubjs` annotations API is append-only mostly, we would need to remove by CFI.
      // But `rendition.annotations.remove` takes CFI and type.
      // If we delete an annotation, we need to know its CFI.
      // A full sync might be: clear all highlights and re-add?
      // Or just track better.
      // For simplicity in this iteration: we only ADD.
      // Real implementation should probably clear specific CFIs if removed.

      const currentIds = new Set(annotations.map(a => a.id));
      addedAnnotations.current.forEach(id => {
          if (!currentIds.has(id)) {
              // Find the annotation object (we don't have it anymore if it's gone from store)
              // We need to store map of ID -> CFI in ref to remove it.
              // For now, let's just accept we might have stale highlights until reload if we don't implement full sync.
              // Improving:
          }
      });
    }
  }, [annotations]); // removed renditionRef.current

  // Inject Custom CSS for Highlights
  useEffect(() => {
      const rendition = renditionRef.current;
      if (rendition) {
          rendition.themes.default({
              '.tts-highlight': {
                  'fill': 'yellow',
                  'background-color': 'rgba(255, 255, 0, 0.3)',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              },
              '.highlight-yellow': {
                  'fill': 'yellow',
                  'background-color': 'rgba(255, 255, 0, 0.3)',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              },
              '.highlight-green': {
                  'fill': 'green',
                  'background-color': 'rgba(0, 255, 0, 0.3)',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              },
              '.highlight-blue': {
                  'fill': 'blue',
                  'background-color': 'rgba(0, 0, 255, 0.3)',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              },
              '.highlight-red': {
                  'fill': 'red',
                  'background-color': 'rgba(255, 0, 0, 0.3)',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              }
          });
      }
  }, []); // removed renditionRef.current, technically should depend on it but ref stable

  const [showToc, setShowToc] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTTS, setShowTTS] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Search State
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Initialize Book
  useEffect(() => {
    if (!id) return;

    const loadBook = async () => {
      setIsLoading(true);
      setCurrentBookId(id);

      try {
        const db = await getDB();
        const fileData = await db.get('files', id);
        const metadata = await db.get('books', id);

        if (!fileData) {
          console.error('Book file not found');
          navigate('/');
          return;
        }

        if (bookRef.current) {
          bookRef.current.destroy();
        }

        const book = ePub(fileData as ArrayBuffer);
        bookRef.current = book;

        if (viewerRef.current) {
          const rendition = book.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            manager: 'default',
          });
          renditionRef.current = rendition;

          // Load navigation/TOC
          const nav = await book.loaded.navigation;
          setToc(nav.toc);

          // Register themes
          rendition.themes.register('light', { body: { background: '#ffffff', color: '#000000' } });
          rendition.themes.register('dark', { body: { background: '#1a1a1a', color: '#f5f5f5' } });
          rendition.themes.register('sepia', { body: { background: '#f4ecd8', color: '#5b4636' } });
          rendition.themes.register('custom', { body: { background: customTheme.bg, color: customTheme.fg } });

          rendition.themes.select(currentTheme);
          rendition.themes.fontSize(`${fontSize}%`);
          rendition.themes.font(fontFamily);
          // Apply line-height via default rule as a workaround since there's no direct API
          rendition.themes.default({
              p: { 'line-height': `${lineHeight} !important` },
              // Also ensure body has it for general text
              body: { 'line-height': `${lineHeight} !important` }
          });

          // Display at saved location or start
          const startLocation = metadata?.currentCfi || undefined;
          await rendition.display(startLocation);

          // Generate locations for progress tracking
          // In a real app, this should be cached. For now, we generate if missing.
          // Since generating locations is expensive, we might want to do it lazily or check if we have it saved.
          // For this step, we'll just await ready and verify readiness.
          await book.ready;
          // Ideally: await book.locations.generate(1000);
          // However, for large books this blocks. We can do it in background or rely on percentage from chapters if locations not ready.
          // Let's try to generate minimal locations for progress bar to work reasonably.
           // This is heavy, maybe we skip for step 03 or do it async without await?
           book.locations.generate(1000);

           // Index for Search (Async)
           // Only index if not already done? Or just do it every time for now (simplicity)
           searchClient.indexBook(book, id).then(() => {
               console.log("Book indexed for search");
           });

          // Text Selection Listener
          rendition.on('selected', (cfiRange: string) => {
            const range = rendition.getRange(cfiRange);
            if (range) {
                const rect = range.getBoundingClientRect();
                // Adjust rect coordinates based on the iframe position if needed,
                // but usually getBoundingClientRect inside iframe is relative to iframe viewport?
                // Wait, getRange returns a DOM Range. getBoundingClientRect is relative to viewport.
                // Since epub.js renders in an iframe, we need to account for iframe position?
                // Actually `rendition.getRange(cfiRange)` returns a range in the iframe document.
                // We need to map that to the main window.

                // However, the popover will be rendered in the main window.
                // We need to translate iframe coordinates to main window coordinates.
                // `viewerRef.current` contains the iframe.
                const iframe = viewerRef.current?.querySelector('iframe');
                if (iframe) {
                   const iframeRect = iframe.getBoundingClientRect();
                   showPopover(
                       rect.left + iframeRect.left,
                       rect.top + iframeRect.top,
                       cfiRange,
                       range.toString()
                   );

                   // Clear selection (optional, but keep it so user sees what they selected)
                   // contents.window.getSelection().removeAllRanges();
                }
            }
          });

          // Clear popover on click elsewhere
          rendition.on('click', () => {
             hidePopover();
          });

          rendition.on('relocated', (location: Location) => {
            const cfi = location.start.cfi;

            // Prevent infinite loop if CFI hasn't changed
            if (cfi === useReaderStore.getState().currentCfi) return;

            hidePopover();
            // Calculate progress
            // Note: book.locations.percentageFromCfi(cfi) only works if locations are generated.
            // If not generated, it might return 0 or throw.
            // We can check book.locations.length()
            let percentage = 0;
            try {
                percentage = book.locations.percentageFromCfi(cfi);
            } catch {
                // Locations not ready yet
            }

            // Get chapter title
            // Usually we find the spine item and check TOC.
            // Simplified:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const item = book.spine.get(location.start.href) as any;
            const title = item ? (item.label || 'Chapter') : 'Unknown';
            // Actually getting title from spine is tricky without matching TOC.
            // We'll leave title as is or implement proper TOC lookup later.

            updateLocation(cfi, percentage, title);

            // Persist to DB (debouncing would be good here)
            saveProgress(id, cfi, percentage);
          });
        }
      } catch (error) {
        console.error('Error loading book:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
      renditionRef.current = null;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  // Handle Theme/Font/Layout changes
  useEffect(() => {
    if (renditionRef.current) {
      // Re-register custom theme in case colors changed
      renditionRef.current.themes.register('custom', {
        body: { background: customTheme.bg, color: customTheme.fg }
      });

      renditionRef.current.themes.select(currentTheme);
      renditionRef.current.themes.fontSize(`${fontSize}%`);
      renditionRef.current.themes.font(fontFamily);

      // Update line height
      renditionRef.current.themes.default({
        p: { 'line-height': `${lineHeight} !important` },
        body: { 'line-height': `${lineHeight} !important` }
      });
    }
  }, [currentTheme, customTheme, fontSize, fontFamily, lineHeight]);

  const handleClearSelection = () => {
      const iframe = viewerRef.current?.querySelector('iframe');
      if (iframe && iframe.contentWindow) {
          iframe.contentWindow.getSelection()?.removeAllRanges();
      }
  };

  const saveProgress = async (bookId: string, cfi: string, progress: number) => {
      try {
          const db = await getDB();
          const tx = db.transaction('books', 'readwrite');
          const store = tx.objectStore('books');
          const book = await store.get(bookId);
          if (book) {
              book.currentCfi = cfi;
              book.progress = progress;
              book.lastRead = Date.now();
              await store.put(book);
          }
          await tx.done;
      } catch (err) {
          console.error("Failed to save progress", err);
      }
  };

  const handlePrev = () => {
      console.log("Navigating to previous page");
      renditionRef.current?.prev();
  };
  const handleNext = () => {
      console.log("Navigating to next page");
      renditionRef.current?.next();
  };

  // Handle Container Resize (e.g. sidebar toggle)
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
                 renditionRef.current?.resize();
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
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-surface shadow-sm z-10">
        <div className="flex items-center gap-2">
          <button aria-label="Back" onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-border">
            <ArrowLeft className="w-5 h-5 text-secondary" />
          </button>
          <button aria-label="Table of Contents" onClick={() => { setShowToc(!showToc); setShowAnnotations(false); }} className={`p-2 rounded-full hover:bg-border ${showToc ? 'bg-border' : ''}`}>
            <List className="w-5 h-5 text-secondary" />
          </button>
          <button aria-label="Annotations" onClick={() => { setShowAnnotations(!showAnnotations); setShowToc(false); }} className={`p-2 rounded-full hover:bg-border ${showAnnotations ? 'bg-border' : ''}`}>
            <Highlighter className="w-5 h-5 text-secondary" />
          </button>
        </div>
        <h1 className="text-sm font-medium truncate max-w-xs text-foreground">
             {currentChapterTitle || 'Reading'}
        </h1>
        <div className="flex items-center gap-2">
           <button aria-label="Search" onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-full hover:bg-border">
                <Search className="w-5 h-5 text-secondary" />
           </button>
           <button aria-label="Text to Speech" onClick={() => setShowTTS(!showTTS)} className={`p-2 rounded-full hover:bg-border ${isPlaying ? 'text-primary' : 'text-secondary'}`}>
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
           </button>
           <button aria-label="Settings" onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-full hover:bg-border">
            <Settings className="w-5 h-5 text-secondary" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex">
         {/* TOC Sidebar */}
         {showToc && (
             <div className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static">
                 <div className="p-4">
                     <h2 className="text-lg font-bold mb-4 text-foreground">Contents</h2>
                     <ul className="space-y-2">
                         {useReaderStore.getState().toc.map((item) => (
                             <li key={item.id}>
                                 <button
                                    className="text-left w-full text-sm text-secondary hover:text-primary"
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

         {/* Annotations Sidebar */}
         {showAnnotations && (
             <div className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-border">
                     <h2 className="text-lg font-bold text-foreground">Annotations</h2>
                 </div>
                 <AnnotationList onNavigate={(cfi) => {
                     renditionRef.current?.display(cfi);
                     if (window.innerWidth < 768) setShowAnnotations(false);
                 }} />
             </div>
         )}

         {/* Search Sidebar */}
         {showSearch && (
             <div className="w-64 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-border">
                     <h2 className="text-lg font-bold mb-2 text-foreground">Search</h2>
                     <div className="flex gap-2">
                         <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    setIsSearching(true);
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
                            onClick={() => setShowSearch(false)}
                            className="p-2 hover:bg-border rounded"
                         >
                            <X className="w-4 h-4 text-muted" />
                         </button>
                     </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4">
                     {isSearching ? (
                         <div className="text-center text-muted">Searching...</div>
                     ) : (
                         <ul className="space-y-4">
                             {searchResults.map((result, idx) => (
                                 <li key={idx} className="border-b border-border pb-2 last:border-0">
                                     <button
                                        className="text-left w-full"
                                        onClick={() => {
                                            renditionRef.current?.display(result.href);
                                        }}
                                     >
                                         <p className="text-xs text-muted mb-1">Result {idx + 1}</p>
                                         <p className="text-sm text-foreground line-clamp-3">
                                             {result.excerpt}
                                         </p>
                                     </button>
                                 </li>
                             ))}
                             {searchResults.length === 0 && searchQuery && !isSearching && (
                                 <div className="text-center text-muted text-sm">No results found</div>
                             )}
                         </ul>
                     )}
                 </div>
             </div>
         )}

         {/* Reader Area */}
         <div className="flex-1 relative">
            <div ref={viewerRef} className="w-full h-full overflow-hidden" />

             <AnnotationPopover bookId={id || ''} onClose={handleClearSelection} />

             {/* TTS Controls */}
             {showTTS && (
                 <div className="absolute top-2 right-14 w-80 bg-surface shadow-lg rounded-lg p-4 border border-border z-30 max-h-[80vh] overflow-y-auto">
                     <div className="flex justify-between items-center mb-2">
                         <h3 className="text-sm font-bold text-foreground">Text to Speech</h3>
                         <button onClick={() => {setShowTTS(false); setShowVoiceSettings(false);}}><X className="w-4 h-4 text-muted" /></button>
                     </div>

                     {!showVoiceSettings ? (
                        <>
                            <div className="flex items-center gap-2 mb-4">
                                <button
                                    onClick={() => {
                                        if (isPlaying) {
                                            pause();
                                        } else {
                                            // Check cost warning
                                            if (providerId !== 'local' && sentences.length > 0) {
                                                const totalChars = sentences.reduce((sum, s) => sum + s.text.length, 0);
                                                // Warn if total text is large (e.g. > 5000 chars ~ 1 page/chapter depending)
                                                // and we are just starting (or resuming a large block, but checking full chapter text for now)
                                                if (totalChars > 5000) {
                                                    const confirmed = window.confirm(
                                                        `You are about to listen to a large section (~${totalChars.toLocaleString()} chars). ` +
                                                        `This may incur costs with ${providerId === 'google' ? 'Google Cloud' : 'OpenAI'}. Proceed?`
                                                    );
                                                    if (!confirmed) return;
                                                }
                                            }
                                            play();
                                        }
                                    }}
                                    className="flex-1 bg-primary text-background py-1 rounded hover:opacity-90 flex justify-center"
                                >
                                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={() => setShowVoiceSettings(true)}
                                    className="px-2 py-1 bg-secondary text-surface rounded hover:opacity-90"
                                >
                                    <Settings className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="mb-2">
                                <label className="block text-xs text-muted mb-1">Speed: {rate}x</label>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="2"
                                    step="0.1"
                                    value={rate}
                                    onChange={(e) => setRate(parseFloat(e.target.value))}
                                    className="w-full accent-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-muted mb-1">Voice</label>
                                <select
                                    className="w-full text-xs p-1 border rounded bg-background text-foreground border-border"
                                    value={voice?.name || ''}
                                    onChange={(e) => {
                                        const selected = availableVoices.find(v => v.name === e.target.value);
                                        setVoice(selected || null);
                                    }}
                                >
                                    <option value="">Default</option>
                                    {availableVoices.map(v => (
                                        <option key={v.id} value={v.name}>{v.name.slice(0, 30)}...</option>
                                    ))}
                                </select>
                            </div>
                        </>
                     ) : (
                        <div className="space-y-4">
                            <button onClick={() => setShowVoiceSettings(false)} className="text-xs text-primary mb-2 flex items-center">
                                <ArrowLeft className="w-3 h-3 mr-1" /> Back
                            </button>

                            <div>
                                <label className="block text-xs font-semibold text-muted mb-1">Provider</label>
                                <select
                                    className="w-full text-xs p-1 border rounded bg-background text-foreground border-border"
                                    value={providerId}
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    onChange={(e) => setProviderId(e.target.value as any)}
                                >
                                    <option value="local">Local (Free)</option>
                                    <option value="google">Google Cloud TTS</option>
                                    <option value="openai">OpenAI TTS</option>
                                </select>
                            </div>

                            {providerId === 'google' && (
                                <div>
                                    <label className="block text-xs font-semibold text-muted mb-1">Google API Key</label>
                                    <input
                                        type="password"
                                        className="w-full text-xs p-1 border rounded bg-background text-foreground border-border"
                                        value={apiKeys.google}
                                        onChange={(e) => setApiKey('google', e.target.value)}
                                        placeholder="Enter Google API Key"
                                    />
                                    <p className="text-[10px] text-muted mt-1">
                                        Needs Cloud Text-to-Speech API enabled.
                                    </p>
                                </div>
                            )}

                            {providerId === 'openai' && (
                                <div>
                                    <label className="block text-xs font-semibold text-muted mb-1">OpenAI API Key</label>
                                    <input
                                        type="password"
                                        className="w-full text-xs p-1 border rounded bg-background text-foreground border-border"
                                        value={apiKeys.openai}
                                        onChange={(e) => setApiKey('openai', e.target.value)}
                                        placeholder="Enter OpenAI API Key"
                                    />
                                </div>
                            )}
                        </div>
                     )}

                     <TTSQueue />
                 </div>
             )}

            {/* Advanced Settings Modal */}
            {showSettings && (
                <ReaderSettings onClose={() => setShowSettings(false)} />
            )}
         </div>
      </div>

      {/* Footer / Controls */}
      <footer className="bg-surface border-t border-border p-2 flex items-center justify-between z-10">
          <button aria-label="Previous Page" onClick={handlePrev} className="p-2 hover:bg-border rounded-full">
              <ChevronLeft className="w-6 h-6 text-secondary" />
          </button>

          <div className="flex-1 mx-4">
              <div className="h-1 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
              </div>
              <div className="text-center text-xs text-muted mt-1">
                  {Math.round(progress * 100)}%
              </div>
          </div>

          <button aria-label="Next Page" onClick={handleNext} className="p-2 hover:bg-border rounded-full">
              <ChevronRight className="w-6 h-6 text-secondary" />
          </button>
      </footer>
    </div>
  );
};
