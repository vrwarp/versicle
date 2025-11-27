import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub, { type Book, type Rendition, type Location } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { useTTSStore } from '../../store/useTTSStore';
import { useTTS } from '../../hooks/useTTS';
import { getDB } from '../../db/db';
import { searchClient, type SearchResult } from '../../lib/search';
import { ChevronLeft, ChevronRight, List, Settings, ArrowLeft, Play, Pause, X, Search, Type } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import { Card } from '../ui/card';

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
      setVoice
  } = useTTSStore();

  // Use TTS Hook
  useTTS(renditionRef.current);

  // Highlight Active TTS Sentence
  useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition || !activeCfi) return;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      rendition.annotations.add('highlight', activeCfi, {}, (e: Event) => {
          console.log("Clicked highlight", e);
      }, 'tts-highlight');

      return () => {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          rendition.annotations.remove(activeCfi, 'highlight');
      };
  }, [activeCfi]);

  // Inject Custom CSS for Highlights
  useEffect(() => {
      const rendition = renditionRef.current;
      if (rendition) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          rendition.themes.default({
              '.tts-highlight': {
                  'fill': 'yellow',
                  'fill-opacity': '0.3',
                  'mix-blend-mode': 'multiply'
              }
          });
      }
  }, [renditionRef.current]);

  const [showSettings, setShowSettings] = useState(false);
  const [showTTS, setShowTTS] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [immersiveMode, setImmersiveMode] = useState(false);

  // Search State
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
      const loadVoices = () => {
          setAvailableVoices(window.speechSynthesis.getVoices());
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

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

          const nav = await book.loaded.navigation;
          setToc(nav.toc);

          rendition.themes.register('light', { body: { background: '#ffffff', color: '#1a1a1a' } });
          rendition.themes.register('dark', { body: { background: '#0a0a0a', color: '#f5f5f5' } });
          rendition.themes.register('sepia', { body: { background: '#f8f4e5', color: '#5b4636' } });

          rendition.themes.select(currentTheme);
          rendition.themes.fontSize(`${fontSize}%`);

          const startLocation = metadata?.currentCfi || undefined;
          await rendition.display(startLocation);

          await book.ready;
          book.locations.generate(1000);

           searchClient.indexBook(book, id).then(() => {
               console.log("Book indexed for search");
           });

          rendition.on('relocated', (location: Location) => {
            const cfi = location.start.cfi;
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`flex flex-col h-screen overflow-hidden transition-colors duration-300 ${currentTheme === 'dark' ? 'bg-gray-950' : currentTheme === 'sepia' ? 'bg-[#f8f4e5]' : 'bg-white'}`}>

      {/* Header */}
      <header className={`absolute top-0 left-0 right-0 z-10 transition-transform duration-300 ${immersiveMode ? '-translate-y-full' : 'translate-y-0'} ${currentTheme === 'dark' ? 'bg-gray-900/90 text-white' : 'bg-white/90 text-gray-900'} backdrop-blur-sm shadow-sm border-b ${currentTheme === 'dark' ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <Button aria-label="Back" variant="ghost" size="icon" onClick={() => navigate('/')} className="hover:bg-black/5 dark:hover:bg-white/10">
              <ArrowLeft className="w-5 h-5" />
            </Button>

            <Sheet>
                <SheetTrigger asChild>
                    <Button aria-label="Table of Contents" variant="ghost" size="icon" className="hover:bg-black/5 dark:hover:bg-white/10">
                        <List className="w-5 h-5" />
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[400px] p-0">
                    <SheetHeader className="p-6 border-b">
                        <SheetTitle>Table of Contents</SheetTitle>
                    </SheetHeader>
                    <div className="overflow-y-auto h-full p-2 pb-20">
                        <ul className="space-y-1">
                             {useReaderStore.getState().toc.map((item, idx) => (
                                 <li key={item.id || idx}>
                                     <button
                                        className="text-left w-full p-3 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors truncate"
                                        onClick={() => {
                                            renditionRef.current?.display(item.href);
                                            // Close sheet implies logic but standard sheet closes on outside click.
                                        }}
                                     >
                                         {item.label}
                                     </button>
                                 </li>
                             ))}
                         </ul>
                    </div>
                </SheetContent>
            </Sheet>
          </div>

          <h1 className="text-sm font-medium truncate max-w-[150px] sm:max-w-md opacity-80">
             {currentChapterTitle || 'Reading'}
          </h1>

          <div className="flex items-center gap-1">
           <Sheet open={showSearch} onOpenChange={setShowSearch}>
                <SheetTrigger asChild>
                   <Button aria-label="Search" variant="ghost" size="icon" className="hover:bg-black/5 dark:hover:bg-white/10">
                        <Search className="w-5 h-5" />
                   </Button>
                </SheetTrigger>
                <SheetContent side="right">
                    <SheetHeader className="mb-4">
                        <SheetTitle>Search</SheetTitle>
                    </SheetHeader>
                     <div className="flex gap-2 mb-4">
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
                            className="flex-1 text-sm p-2 border rounded bg-background"
                         />
                     </div>
                     <div className="flex-1 overflow-y-auto -mx-6 px-6">
                         {isSearching ? (
                             <div className="text-center text-muted-foreground py-8">Searching...</div>
                         ) : (
                             <div className="space-y-4 pb-20">
                                 {searchResults.map((result, idx) => (
                                     <div key={idx} className="border-b pb-4 last:border-0">
                                         <button
                                            className="text-left w-full hover:opacity-70"
                                            onClick={() => {
                                                renditionRef.current?.display(result.href);
                                                setShowSearch(false);
                                            }}
                                         >
                                             <p className="text-xs text-muted-foreground mb-1">Result {idx + 1}</p>
                                             <p className="text-sm line-clamp-3">
                                                 {result.excerpt}
                                             </p>
                                         </button>
                                     </div>
                                 ))}
                                 {searchResults.length === 0 && searchQuery && !isSearching && (
                                     <div className="text-center text-muted-foreground py-8">No results found</div>
                                 )}
                             </div>
                         )}
                     </div>
                </SheetContent>
           </Sheet>

           <Button
                aria-label="Text to Speech"
                variant="ghost"
                size="icon"
                onClick={() => setShowTTS(!showTTS)}
                className={`hover:bg-black/5 dark:hover:bg-white/10 ${isPlaying ? 'text-blue-500' : ''}`}
            >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
           </Button>

           <Button
                aria-label="Settings"
                variant="ghost"
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
                className="hover:bg-black/5 dark:hover:bg-white/10"
            >
                <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div
        className="flex-1 relative w-full h-full"
        onClick={() => setImmersiveMode(!immersiveMode)}
      >
        <div ref={viewerRef} className="w-full h-full" />
      </div>

        {/* TTS Controls (Floating) */}
         {showTTS && (
             <div className="absolute top-16 right-4 w-72 z-30">
                 <Card className="p-4 shadow-xl border-t-4 border-blue-500">
                     <div className="flex justify-between items-center mb-4">
                         <h3 className="font-semibold text-sm">Text to Speech</h3>
                         <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowTTS(false)}>
                             <X className="w-4 h-4" />
                         </Button>
                     </div>
                     <div className="flex gap-2 mb-4">
                         <Button onClick={isPlaying ? pause : play} className="w-full">
                             {isPlaying ? <Pause className="mr-2 w-4 h-4" /> : <Play className="mr-2 w-4 h-4" />}
                             {isPlaying ? 'Pause' : 'Play'}
                         </Button>
                     </div>
                     <div className="space-y-4">
                         <div>
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>Speed</span>
                                <span>{rate}x</span>
                            </div>
                            <Slider
                                value={[rate]}
                                min={0.5} max={2} step={0.1}
                                onValueChange={([val]) => setRate(val)}
                            />
                         </div>
                         <select
                            className="w-full text-xs p-2 border rounded bg-background"
                            value={voice?.name || ''}
                            onChange={(e) => {
                                const selected = availableVoices.find(v => v.name === e.target.value);
                                setVoice(selected || null);
                            }}
                         >
                             <option value="">Default Voice</option>
                             {availableVoices.map(v => (
                                 <option key={v.name} value={v.name}>{v.name.slice(0, 25)}</option>
                             ))}
                         </select>
                     </div>
                 </Card>
             </div>
         )}

         {/* Settings Panel (Floating) */}
         {showSettings && (
            <div className="absolute top-16 right-4 w-64 z-30">
                <Card className="p-4 shadow-xl">
                    <div className="flex justify-between items-center mb-4">
                         <h3 className="font-semibold text-sm">Appearance</h3>
                         <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSettings(false)}>
                             <X className="w-4 h-4" />
                         </Button>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-2 block">Theme</label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => useReaderStore.getState().setTheme('light')}
                                    className={`flex flex-col items-center justify-center p-2 rounded border ${currentTheme === 'light' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}
                                >
                                    <div className="w-full h-8 bg-white border border-gray-100 rounded mb-1"></div>
                                    <span className="text-[10px]">Light</span>
                                </button>
                                <button
                                    onClick={() => useReaderStore.getState().setTheme('sepia')}
                                    className={`flex flex-col items-center justify-center p-2 rounded border ${currentTheme === 'sepia' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}
                                >
                                    <div className="w-full h-8 bg-[#f8f4e5] border border-orange-100 rounded mb-1"></div>
                                    <span className="text-[10px]">Sepia</span>
                                </button>
                                <button
                                    onClick={() => useReaderStore.getState().setTheme('dark')}
                                    className={`flex flex-col items-center justify-center p-2 rounded border ${currentTheme === 'dark' ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}
                                >
                                    <div className="w-full h-8 bg-[#1a1a1a] rounded mb-1"></div>
                                    <span className="text-[10px]">Dark</span>
                                </button>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between text-xs font-medium text-muted-foreground mb-2">
                                <span>Font Size</span>
                                <span>{fontSize}%</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Type className="w-3 h-3" />
                                <Slider
                                    value={[fontSize]}
                                    min={80} max={200} step={10}
                                    onValueChange={([val]) => useReaderStore.getState().setFontSize(val)}
                                />
                                <Type className="w-5 h-5" />
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
         )}

      {/* Footer */}
      <footer className={`absolute bottom-0 left-0 right-0 z-10 transition-transform duration-300 ${immersiveMode ? 'translate-y-full' : 'translate-y-0'} ${currentTheme === 'dark' ? 'bg-gray-900/90' : 'bg-white/90'} backdrop-blur-sm border-t ${currentTheme === 'dark' ? 'border-gray-800' : 'border-gray-200'} pb-safe`}>
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
              <Button aria-label="Previous Page" variant="ghost" size="icon" onClick={handlePrev} disabled={!bookRef.current}>
                  <ChevronLeft className="w-6 h-6" />
              </Button>

              <div className="flex-1 flex flex-col gap-1">
                  <Slider
                      value={[progress * 100]}
                      max={100}
                      step={0.1}
                      onValueChange={() => {
                          // Allow scrubbing ideally, for now just visual
                      }}
                      className="cursor-default"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground px-1">
                      <span>{Math.round(progress * 100)}%</span>
                  </div>
              </div>

              <Button aria-label="Next Page" variant="ghost" size="icon" onClick={handleNext} disabled={!bookRef.current}>
                  <ChevronRight className="w-6 h-6" />
              </Button>
          </div>
      </footer>
    </div>
  );
};
