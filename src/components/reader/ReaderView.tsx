import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub, { type Book, type Rendition, type Location } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useTTS } from '../../hooks/useTTS';
import { getDB } from '../../db/db';
import { searchClient, type SearchResult } from '../../lib/search';
import { ChevronLeft, ChevronRight, List, Settings, ArrowLeft, Play, Pause, X, Search } from 'lucide-react';

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
      voices: availableVoices
  } = useTTSStore();

  // Use TTS Hook
  useTTS(renditionRef.current);

  // Highlight Active TTS Sentence
  useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition || !activeCfi) return;

      // Add highlight
      rendition.annotations.add('highlight', activeCfi, {}, (e: Event) => {
          console.log("Clicked highlight", e);
      }, 'tts-highlight');

      // Remove highlight when activeCfi changes
      return () => {
          rendition.annotations.remove(activeCfi, 'highlight');
      };
  }, [activeCfi]);

  // Inject Custom CSS for Highlights
  useEffect(() => {
      const rendition = renditionRef.current;
      if (rendition) {
          rendition.themes.default({
              '.tts-highlight': {
                  'fill': 'yellow',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              }
          });
      }
  }, [renditionRef.current]);

  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTTS, setShowTTS] = useState(false);

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

          rendition.themes.select(currentTheme);
          rendition.themes.fontSize(`${fontSize}%`);

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

          rendition.on('relocated', (location: Location) => {
            const cfi = location.start.cfi;
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

  // Handle Theme/Font changes
  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.select(currentTheme);
      renditionRef.current.themes.fontSize(`${fontSize}%`);
    }
  }, [currentTheme, fontSize]);

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

  const handlePrev = () => renditionRef.current?.prev();
  const handleNext = () => renditionRef.current?.next();

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
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <button aria-label="Back" onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
            <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-200" />
          </button>
          <button aria-label="Table of Contents" onClick={() => setShowToc(!showToc)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
            <List className="w-5 h-5 text-gray-700 dark:text-gray-200" />
          </button>
        </div>
        <h1 className="text-sm font-medium truncate max-w-xs text-gray-800 dark:text-gray-200">
             {currentChapterTitle || 'Reading'}
        </h1>
        <div className="flex items-center gap-2">
           <button aria-label="Search" onClick={() => setShowSearch(!showSearch)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                <Search className="w-5 h-5 text-gray-700 dark:text-gray-200" />
           </button>
           <button aria-label="Text to Speech" onClick={() => setShowTTS(!showTTS)} className={`p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 ${isPlaying ? 'text-blue-500' : 'text-gray-700 dark:text-gray-200'}`}>
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
           </button>
           <button aria-label="Settings" onClick={() => setShowSettings(!showSettings)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
            <Settings className="w-5 h-5 text-gray-700 dark:text-gray-200" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex">
         {/* TOC Sidebar */}
         {showToc && (
             <div className="w-64 shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto z-20 absolute inset-y-0 left-0 md:static">
                 <div className="p-4">
                     <h2 className="text-lg font-bold mb-4 dark:text-white">Contents</h2>
                     <ul className="space-y-2">
                         {useReaderStore.getState().toc.map((item) => (
                             <li key={item.id}>
                                 <button
                                    className="text-left w-full text-sm text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400"
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

         {/* Search Sidebar */}
         {showSearch && (
             <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col">
                 <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                     <h2 className="text-lg font-bold mb-2 dark:text-white">Search</h2>
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
                            className="flex-1 text-sm p-2 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
                         />
                         <button
                            onClick={() => setShowSearch(false)}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                         >
                            <X className="w-4 h-4 text-gray-500" />
                         </button>
                     </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4">
                     {isSearching ? (
                         <div className="text-center text-gray-500">Searching...</div>
                     ) : (
                         <ul className="space-y-4">
                             {searchResults.map((result, idx) => (
                                 <li key={idx} className="border-b border-gray-100 dark:border-gray-700 pb-2 last:border-0">
                                     <button
                                        className="text-left w-full"
                                        onClick={() => {
                                            renditionRef.current?.display(result.href);
                                            // Optionally highlight search term?
                                            // renditionRef.current.annotations.add('highlight', ...)
                                        }}
                                     >
                                         <p className="text-xs text-gray-500 mb-1">Result {idx + 1}</p>
                                         <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-3">
                                             {result.excerpt}
                                         </p>
                                     </button>
                                 </li>
                             ))}
                             {searchResults.length === 0 && searchQuery && !isSearching && (
                                 <div className="text-center text-gray-500 text-sm">No results found</div>
                             )}
                         </ul>
                     )}
                 </div>
             </div>
         )}

         {/* Reader Area */}
         <div className="flex-1 relative">
            <div ref={viewerRef} className="w-full h-full" />

             {/* TTS Controls */}
             {showTTS && (
                 <div className="absolute top-2 right-14 w-64 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 border border-gray-200 dark:border-gray-700 z-30">
                     <div className="flex justify-between items-center mb-2">
                         <h3 className="text-sm font-bold dark:text-white">Text to Speech</h3>
                         <button onClick={() => setShowTTS(false)}><X className="w-4 h-4 text-gray-500" /></button>
                     </div>
                     <div className="flex items-center gap-2 mb-4">
                         <button
                            onClick={isPlaying ? pause : play}
                            className="flex-1 bg-blue-600 text-white py-1 rounded hover:bg-blue-700 flex justify-center"
                         >
                             {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                         </button>
                     </div>
                     <div className="mb-2">
                         <label className="block text-xs text-gray-500 mb-1">Speed: {rate}x</label>
                         <input
                            type="range"
                            min="0.5"
                            max="2"
                            step="0.1"
                            value={rate}
                            onChange={(e) => setRate(parseFloat(e.target.value))}
                            className="w-full"
                         />
                     </div>
                     <div>
                         <label className="block text-xs text-gray-500 mb-1">Voice</label>
                         <select
                            className="w-full text-xs p-1 border rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
                            value={voice?.name || ''}
                            onChange={(e) => {
                                const selected = availableVoices.find(v => v.name === e.target.value);
                                setVoice(selected || null);
                            }}
                         >
                             <option value="">Default</option>
                             {availableVoices.map(v => (
                                 <option key={v.id} value={v.name}>{v.name.slice(0, 20)}...</option>
                             ))}
                         </select>
                     </div>
                 </div>
             )}

            {/* Settings Modal (Simplified) */}
            {showSettings && (
                <div className="absolute top-2 right-2 w-48 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 border border-gray-200 dark:border-gray-700 z-30">
                    <div className="mb-4">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Theme</label>
                        <div className="flex gap-2">
                             {(['light', 'dark', 'sepia'] as const).map((theme) => (
                                 <button
                                    key={theme}
                                    onClick={() => useReaderStore.getState().setTheme(theme)}
                                    className={`w-6 h-6 rounded-full border ${currentTheme === theme ? 'ring-2 ring-blue-500' : ''}`}
                                    style={{ background: theme === 'light' ? '#fff' : theme === 'dark' ? '#333' : '#f4ecd8' }}
                                 />
                             ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Font Size</label>
                        <div className="flex items-center justify-between">
                            <button onClick={() => useReaderStore.getState().setFontSize(Math.max(80, fontSize - 10))} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">-</button>
                            <span className="text-sm dark:text-white">{fontSize}%</span>
                            <button onClick={() => useReaderStore.getState().setFontSize(Math.min(200, fontSize + 10))} className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">+</button>
                        </div>
                    </div>
                </div>
            )}
         </div>
      </div>

      {/* Footer / Controls */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2 flex items-center justify-between z-10">
          <button aria-label="Previous Page" onClick={handlePrev} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full">
              <ChevronLeft className="w-6 h-6 text-gray-600 dark:text-gray-300" />
          </button>

          <div className="flex-1 mx-4">
              <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progress * 100}%` }}
                  />
              </div>
              <div className="text-center text-xs text-gray-500 mt-1">
                  {Math.round(progress * 100)}%
              </div>
          </div>

          <button aria-label="Next Page" onClick={handleNext} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full">
              <ChevronRight className="w-6 h-6 text-gray-600 dark:text-gray-300" />
          </button>
      </footer>
    </div>
  );
};
