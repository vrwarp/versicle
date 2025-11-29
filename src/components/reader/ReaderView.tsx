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
import { TTSQueue } from './TTSQueue';
import { TTSAbbreviationSettings } from './TTSAbbreviationSettings';
import { Toast, type ToastType } from '../ui/Toast';
import { Dialog } from '../ui/Dialog';
import { getDB } from '../../db/db';
import { searchClient, type SearchResult } from '../../lib/search';
import { ChevronLeft, ChevronRight, List, Settings, ArrowLeft, Play, Pause, X, Search, Highlighter, Loader2 } from 'lucide-react';

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
    currentChapterTitle,
    isLoading
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
      setApiKey,
      lastError,
      clearError,
      enableCostWarning,
      setEnableCostWarning
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition as any).annotations.add('highlight', activeCfi, {}, () => {
          // Click handler for TTS highlight
      }, 'tts-highlight');

      // Remove highlight when activeCfi changes
      return () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition as any).annotations.remove(activeCfi, 'highlight');
      };
  }, [activeCfi]);

  // Load Annotations
  useEffect(() => {
    if (id) {
      loadAnnotations(id);
    }
  }, [id, loadAnnotations]);

  // Apply Annotations to Rendition
  const addedAnnotations = useRef<Set<string>>(new Set());

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) {
      // Add new annotations
      annotations.forEach(annotation => {
        if (!addedAnnotations.current.has(annotation.id)) {
           // eslint-disable-next-line @typescript-eslint/no-explicit-any
           (rendition as any).annotations.add('highlight', annotation.cfiRange, {}, () => {
                console.log("Clicked annotation", annotation.id);
            }, annotation.color === 'yellow' ? 'highlight-yellow' :
               annotation.color === 'green' ? 'highlight-green' :
               annotation.color === 'blue' ? 'highlight-blue' :
               annotation.color === 'red' ? 'highlight-red' : 'highlight-yellow');
           addedAnnotations.current.add(annotation.id);
        }
      });
    }
  }, [annotations]);

  // Handle TTS Errors
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastType, setToastType] = useState<ToastType>('error');

  useEffect(() => {
      if (lastError) {
          setToastMessage(lastError);
          setToastType('error');
          setShowToast(true);
      }
  }, [lastError]);

  // Inject Custom CSS for Highlights
  useEffect(() => {
      const rendition = renditionRef.current;
      if (rendition) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition.themes as any).default({
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
  }, []);

  const [showToc, setShowToc] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTTS, setShowTTS] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [showCostWarning, setShowCostWarning] = useState(false);

  // Search State
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHasRun, setSearchHasRun] = useState(false);

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
          setToastMessage('Book file not found');
          setToastType('error');
          setShowToast(true);
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

          // Disable spreads
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition as any).spread('none');

          // Load navigation/TOC
          const nav = await book.loaded.navigation;
          setToc(nav.toc);

          // Register themes
          rendition.themes.register('light', `
            body { background: #ffffff !important; color: #000000 !important; }
            p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
            a { color: #0000ee !important; }
          `);
          rendition.themes.register('dark', `
            body { background: #1a1a1a !important; color: #f5f5f5 !important; }
            p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
            a { color: #6ab0f3 !important; }
          `);
          rendition.themes.register('sepia', `
            body { background: #f4ecd8 !important; color: #5b4636 !important; }
            p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
            a { color: #0000ee !important; }
          `);
          rendition.themes.register('custom', `
            body { background: ${customTheme.bg} !important; color: ${customTheme.fg} !important; }
            p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
          `);

          rendition.themes.select(currentTheme);
          rendition.themes.fontSize(`${fontSize}%`);
          rendition.themes.font(fontFamily);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition.themes as any).default({
              p: { 'line-height': `${lineHeight} !important` },
              body: { 'line-height': `${lineHeight} !important` }
          });

          // Display at saved location or start
          const startLocation = metadata?.currentCfi || undefined;
          await rendition.display(startLocation);
          await book.ready;
          book.locations.generate(1000);

           // Index for Search
           searchClient.indexBook(book, id).then(() => {
               console.log("Book indexed for search");
           });

          // Text Selection Listener
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
            } catch {
                // Locations not ready
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const item = book.spine.get(location.start.href) as any;
            const title = item ? (item.label || 'Chapter') : 'Unknown';

            updateLocation(cfi, percentage, title);
            saveProgress(id, cfi, percentage);
          });
        }
      } catch (error) {
        console.error('Error loading book:', error);
        setToastMessage('Failed to load book content. File may be corrupt.');
        setToastType('error');
        setShowToast(true);
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
      renditionRef.current.themes.register('custom', `
        body { background: ${customTheme.bg} !important; color: ${customTheme.fg} !important; }
        p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
      `);

      renditionRef.current.themes.select(currentTheme);
      renditionRef.current.themes.fontSize(`${fontSize}%`);
      renditionRef.current.themes.font(fontFamily);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (renditionRef.current.themes as any).default({
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
      renditionRef.current?.prev();
  };
  const handleNext = () => {
      renditionRef.current?.next();
  };

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground relative">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-surface shadow-sm z-10">
        <div className="flex items-center gap-2">
          <button data-testid="reader-back-button" aria-label="Back" onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-border">
            <ArrowLeft className="w-5 h-5 text-secondary" />
          </button>
          <button data-testid="reader-toc-button" aria-label="Table of Contents" onClick={() => { setShowToc(!showToc); setShowAnnotations(false); }} className={`p-2 rounded-full hover:bg-border ${showToc ? 'bg-border' : ''}`}>
            <List className="w-5 h-5 text-secondary" />
          </button>
          <button data-testid="reader-annotations-button" aria-label="Annotations" onClick={() => { setShowAnnotations(!showAnnotations); setShowToc(false); }} className={`p-2 rounded-full hover:bg-border ${showAnnotations ? 'bg-border' : ''}`}>
            <Highlighter className="w-5 h-5 text-secondary" />
          </button>
        </div>
        <h1 className="text-sm font-medium truncate max-w-xs text-foreground">
             {currentChapterTitle || 'Reading'}
        </h1>
        <div className="flex items-center gap-2">
           <button data-testid="reader-search-button" aria-label="Search" onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-full hover:bg-border">
                <Search className="w-5 h-5 text-secondary" />
           </button>
           <button data-testid="reader-tts-button" aria-label="Text to Speech" onClick={() => setShowTTS(!showTTS)} className={`p-2 rounded-full hover:bg-border ${isPlaying ? 'text-primary' : 'text-secondary'}`}>
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
           </button>
           <button data-testid="reader-settings-button" aria-label="Settings" onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-full hover:bg-border">
            <Settings className="w-5 h-5 text-secondary" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex">
         {/* TOC Sidebar */}
         {showToc && (
             <div data-testid="reader-toc-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static">
                 <div className="p-4">
                     <h2 className="text-lg font-bold mb-4 text-foreground">Contents</h2>
                     <ul className="space-y-2">
                         {useReaderStore.getState().toc.map((item, index) => (
                             <li key={item.id}>
                                 <button
                                    data-testid={`toc-item-${index}`}
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
                                    setSearchHasRun(true);
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
                            <X className="w-4 h-4 text-muted" />
                         </button>
                     </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4">
                     {isSearching ? (
                         <div className="flex justify-center items-center py-8">
                             <Loader2 className="w-6 h-6 animate-spin text-primary" />
                         </div>
                     ) : (
                         <ul className="space-y-4">
                             {searchResults.map((result, idx) => (
                                 <li key={idx} className="border-b border-border pb-2 last:border-0">
                                     <button
                                        data-testid={`search-result-${idx}`}
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
                             {searchHasRun && searchResults.length === 0 && !isSearching && (
                                 <div className="text-center text-muted text-sm py-8">
                                    <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    No results found for "{searchQuery}"
                                 </div>
                             )}
                             {!searchHasRun && (
                                 <div className="text-center text-muted text-sm py-8">
                                     Enter a keyword and press Enter to search.
                                 </div>
                             )}
                         </ul>
                     )}
                 </div>
             </div>
         )}

         {/* Reader Area */}
         <div className="flex-1 relative min-w-0">
             {isLoading && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/80 z-50 backdrop-blur-sm">
                     <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                     <p className="text-lg font-medium text-foreground">Opening Book...</p>
                 </div>
             )}

            <div data-testid="reader-iframe-container" ref={viewerRef} className="w-full h-full overflow-hidden" />

             <AnnotationPopover bookId={id || ''} onClose={handleClearSelection} />

             {/* TTS Controls */}
             {showTTS && (
                 <div data-testid="tts-panel" className="absolute top-2 right-14 w-80 bg-surface shadow-lg rounded-lg p-4 border border-border z-30 max-h-[80vh] overflow-y-auto">
                     <div className="flex justify-between items-center mb-2">
                         <h3 className="text-sm font-bold text-foreground">Text to Speech</h3>
                         <button onClick={() => {setShowTTS(false); setShowVoiceSettings(false);}}><X className="w-4 h-4 text-muted" /></button>
                     </div>

                     {!showVoiceSettings ? (
                        <>
                            <div className="flex items-center gap-2 mb-4">
                                <button
                                    data-testid="tts-play-pause-button"
                                    onClick={() => {
                                        if (isPlaying) {
                                            pause();
                                        } else {
                                            if (providerId !== 'local' && sentences.length > 0 && enableCostWarning) {
                                                const totalChars = sentences.reduce((sum, s) => sum + s.text.length, 0);
                                                if (totalChars > 5000) {
                                                    setShowCostWarning(true);
                                                    return;
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
                                    data-testid="tts-settings-button"
                                    onClick={() => setShowVoiceSettings(true)}
                                    className="px-2 py-1 bg-secondary text-surface rounded hover:opacity-90"
                                    aria-label="Voice Settings"
                                >
                                    <Settings className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="mb-2">
                                <label className="block text-xs text-muted mb-1">Speed: {rate}x</label>
                                <input
                                    data-testid="tts-speed-slider"
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
                                    data-testid="tts-voice-select"
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
                                    data-testid="tts-provider-select"
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

                            <div className="pt-2 border-t border-border">
                                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={enableCostWarning}
                                        onChange={(e) => setEnableCostWarning(e.target.checked)}
                                        className="accent-primary"
                                    />
                                    <span className="text-xs text-foreground">Warn before large synthesis</span>
                                </label>
                                <TTSAbbreviationSettings />
                            </div>
                        </div>
                     )}

                     <TTSQueue />
                 </div>
             )}

            <Dialog
                isOpen={showCostWarning}
                onClose={() => setShowCostWarning(false)}
                title="Cost Warning"
                description={`You are about to listen to a large section (~${sentences.reduce((sum, s) => sum + s.text.length, 0).toLocaleString()} chars). This may incur costs.`}
                footer={
                    <>
                        <button
                            onClick={() => setShowCostWarning(false)}
                            className="px-3 py-1 text-sm text-secondary hover:text-primary"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                setShowCostWarning(false);
                                play();
                            }}
                            className="px-3 py-1 text-sm bg-primary text-background rounded hover:opacity-90"
                        >
                            Proceed
                        </button>
                    </>
                }
            />

            {showSettings && (
                <ReaderSettings onClose={() => setShowSettings(false)} />
            )}
         </div>
      </div>

      <Toast
          message={toastMessage}
          isVisible={showToast}
          type={toastType}
          onClose={() => {
              setShowToast(false);
              clearError();
          }}
      />

      {/* Footer / Controls */}
      <footer className="bg-surface border-t border-border p-2 flex items-center justify-between z-10">
          <button data-testid="reader-prev-page" aria-label="Previous Page" onClick={handlePrev} className="p-2 hover:bg-border rounded-full">
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

          <button data-testid="reader-next-page" aria-label="Next Page" onClick={handleNext} className="p-2 hover:bg-border rounded-full">
              <ChevronRight className="w-6 h-6 text-secondary" />
          </button>
      </footer>
    </div>
  );
};
