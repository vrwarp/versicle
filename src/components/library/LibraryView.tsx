import React, { useEffect, useState, useRef, useLayoutEffect, useCallback } from 'react';
import { useLibraryStore, type ViewMode } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { EmptyLibrary } from './EmptyLibrary';
import { Upload, Settings, LayoutGrid, FilePlus, ChevronDown } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { Button } from '../ui/Button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '../ui/DropdownMenu';

// Views
import { ClassicGrid } from './views/ClassicGrid';
import { ModernCards } from './views/ModernCards';
import { MinimalList } from './views/MinimalList';
import { DetailedList } from './views/DetailedList';
import { HeroCard } from './views/HeroCard';
import { StackedView } from './views/StackedView';
import { CompactGrid } from './views/CompactGrid';
import { Carousel } from './views/Carousel';
import { Timeline } from './views/Timeline';
import { MasonryGrid } from './views/MasonryGrid';
import { CoverOnly } from './views/CoverOnly';
import { AuthorFocus } from './views/AuthorFocus';

export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error, addBook, isImporting, viewMode, setViewMode } = useLibraryStore();
  const { setGlobalSettingsOpen } = useUIStore();
  const showToast = useToastStore(state => state.showToast);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0
  });
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      window.requestAnimationFrame(() => {
        if (!Array.isArray(entries) || !entries.length) return;
        const entry = entries[0];
        const { width } = entry.contentRect;
        if (width <= 0) return;

        // Use container height for the view components
        const height = entry.contentRect.height;

        setDimensions(prev => {
            if (prev.width === width && prev.height === height) return prev;
            return { width, height };
        });
      });
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isLoading]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addBook(e.target.files[0]).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        showToast(`Import failed: ${err.message}`, "error");
      });
    }
    if (e.target.value) e.target.value = '';
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  }, [dragActive]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
       const file = e.dataTransfer.files[0];
       if (!file.name.toLowerCase().endsWith('.epub')) {
           showToast("Only .epub files are supported", "error");
           return;
       }

       addBook(file).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        showToast(`Import failed: ${err.message}`, "error");
      });
    }
  }, [addBook, showToast]);

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const renderView = () => {
      const props = { books, dimensions };
      switch (viewMode) {
          case 'classic-grid': return <ClassicGrid {...props} />;
          case 'modern-cards': return <ModernCards {...props} />;
          case 'minimal-list': return <MinimalList {...props} />;
          case 'detailed-list': return <DetailedList {...props} />;
          case 'hero-card': return <HeroCard {...props} />;
          case 'stacked': return <StackedView {...props} />;
          case 'compact-grid': return <CompactGrid {...props} />;
          case 'carousel': return <Carousel {...props} />;
          case 'timeline': return <Timeline {...props} />;
          case 'masonry': return <MasonryGrid {...props} />;
          case 'cover-only': return <CoverOnly {...props} />;
          case 'author-focus': return <AuthorFocus {...props} />;
          default: return <ClassicGrid {...props} />;
      }
  };

  const viewLabels: Record<ViewMode, string> = {
      'classic-grid': 'Classic Grid',
      'modern-cards': 'Modern Cards',
      'minimal-list': 'Minimal List',
      'detailed-list': 'Detailed List',
      'hero-card': 'Hero Card',
      'stacked': 'Stacked View',
      'compact-grid': 'Compact Grid',
      'carousel': 'Carousel',
      'timeline': 'Timeline',
      'masonry': 'Masonry Grid',
      'cover-only': 'Cover Only',
      'author-focus': 'Author Focus'
  };

  return (
    <div
      data-testid="library-view"
      className="container mx-auto px-4 py-8 max-w-7xl h-screen flex flex-col bg-background text-foreground relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".epub"
        className="hidden"
        data-testid="hidden-file-input"
      />

      {/* Drag Overlay */}
      {dragActive && (
        <div className="absolute inset-4 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center border-4 border-primary border-dashed rounded-xl transition-all duration-200 pointer-events-none">
            <div className="flex flex-col items-center gap-4 text-primary animate-in zoom-in-95 duration-200">
                <FilePlus className="w-20 h-20" />
                <p className="text-3xl font-bold">Drop EPUB to import</p>
            </div>
        </div>
      )}

      <header className="mb-4 flex-none flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">My Library</h1>
          <p className="text-muted-foreground text-sm">Manage and read your collection</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 min-w-[140px] justify-between">
                        <span className="flex items-center gap-2 truncate">
                            <LayoutGrid className="w-4 h-4" />
                            <span className="truncate">{viewLabels[viewMode]}</span>
                        </span>
                        <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-[80vh] overflow-y-auto">
                    <DropdownMenuLabel>Layouts</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Foundational</DropdownMenuLabel>
                        <DropdownMenuRadioItem value="classic-grid">Classic Grid</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="modern-cards">Modern Cards</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="minimal-list">Minimal List</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="detailed-list">Detailed List</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="hero-card">Hero Card</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="stacked">Stacked View</DropdownMenuRadioItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Alternative</DropdownMenuLabel>
                        <DropdownMenuRadioItem value="compact-grid">Compact Grid</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="carousel">Carousel</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="timeline">Timeline</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="masonry">Masonry Grid</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="cover-only">Cover Only</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="author-focus">Author Focus</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="secondary"
              size="icon"
              onClick={() => setGlobalSettingsOpen(true)}
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              onClick={triggerFileUpload}
              disabled={isImporting}
              className="gap-2"
            >
              {isImporting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Import</span>
            </Button>
        </div>
      </header>

      {error && (
        <section className="mb-6 flex-none">
          <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
              {error}
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center py-12 flex-1">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      ) : (
        <section className="flex-1 min-h-0 w-full overflow-hidden" ref={containerRef}>
          {books.length === 0 ? (
             <EmptyLibrary onImport={triggerFileUpload} />
          ) : (
             renderView()
          )}
        </section>
      )}
    </div>
  );
};
