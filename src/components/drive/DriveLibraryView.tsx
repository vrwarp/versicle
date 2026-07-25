/**
 * DriveLibraryView — the Google Drive shelf, rendered by the `/drive` route
 * inside the same LibraryView shell as My Library / Notes / Search (the header
 * dropdown switches between them).
 *
 * This is the promoted form of the old DriveImportDialog: same index-backed
 * instant search, same manual re-scan, same pre-import preview sheet — but with
 * the room a page affords. Two things it gains from the page treatment:
 *
 *  - **Infinite scroll.** The dialog capped the unsearched list at the first 50
 *    entries; here the whole index is reachable, paged in as the sentinel
 *    scrolls into range so a multi-thousand-file Drive folder never mounts at
 *    once.
 *  - **The library's own grid/list views.** Cover art and verified
 *    title/author come from the Drive preview cache (R4/R7), which is what
 *    makes a cover grid worth rendering at all — rows without a cached preview
 *    degrade to filename + size, never to a broken tile.
 *
 * The view is read-only over the PERSISTED index: nothing here triggers a Drive
 * scan except the explicit Refresh control.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud, FolderSearch, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { LibrarySearchBar, type LibrarySearchBarRef } from '../library/LibrarySearchBar';
import { useDriveStore, type DriveFileIndex } from '@store/useDriveStore';
import { useBookStore } from '@store/useBookStore';
import { useToastStore } from '@store/useToastStore';
import { getDriveLibrarySync } from '@domains/google';
import { compareTitles, formatRelativeTime } from '@kernel/locale/format';
import { createLogger } from '@lib/logger';
import { DriveBookCard } from './DriveBookCard';
import { DriveBookListItem } from './DriveBookListItem';
import { DrivePreviewSheet } from './DrivePreviewSheet';

const logger = createLogger('DriveLibraryView');

/**
 * Files added per infinite-scroll page. Sized so one page reliably overshoots
 * a viewport in both layouts — an undersized page would leave the sentinel
 * parked inside the observer's root margin, which stalls paging until the next
 * intersection transition.
 */
const PAGE_SIZE = 24;

type DriveSortOrder = 'recent' | 'name' | 'size';
type DriveFilterMode = 'all' | 'new';

interface DriveLibraryViewProps {
  /** The shared library layout preference — the shelf honours the same toggle. */
  viewMode: 'grid' | 'list';
}

export const DriveLibraryView: React.FC<DriveLibraryViewProps> = ({ viewMode }) => {
  const navigate = useNavigate();
  const index = useDriveStore((s) => s.index);
  const lastScanTime = useDriveStore((s) => s.lastScanTime);
  const isScanning = useDriveStore((s) => s.isScanning);
  const linkedFolderId = useDriveStore((s) => s.linkedFolderId);
  const linkedFolderName = useDriveStore((s) => s.linkedFolderName);
  const books = useBookStore((s) => s.books);
  const showToast = useToastStore((state) => state.showToast);

  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filterMode, setFilterMode] = useState<DriveFilterMode>('all');
  const [sortOrder, setSortOrder] = useState<DriveSortOrder>('recent');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DriveFileIndex | null>(null);
  const searchBarRef = useRef<LibrarySearchBarRef>(null);

  /** Filenames the library already holds — the "already imported" signal. */
  const libraryFilenames = useMemo(
    () => new Set(Object.values(books).map((b) => b.sourceFilename)),
    [books],
  );

  const filteredFiles = useMemo(() => {
    const query = debouncedQuery.trim().toLowerCase();
    // Single-pass filter (no intermediate arrays): the index can hold
    // thousands of entries and this runs on every filter/sort change.
    const filtered: DriveFileIndex[] = [];
    for (const file of index) {
      if (query && !file.name.toLowerCase().includes(query)) continue;
      if (filterMode === 'new' && libraryFilenames.has(file.name)) continue;
      filtered.push(file);
    }
    return filtered.sort((a, b) => {
      switch (sortOrder) {
        case 'name':
          return compareTitles(a.name, b.name);
        case 'size':
          return b.size - a.size;
        case 'recent':
        default:
          // ISO-8601 stamps compare lexicographically; newest first.
          return (b.modifiedTime || '').localeCompare(a.modifiedTime || '');
      }
    });
  }, [index, debouncedQuery, filterMode, libraryFilenames, sortOrder]);

  // Paging state, keyed to the active query/filter/sort so a changed list
  // starts back at page one. Adjusted DURING RENDER (React's "reset state on
  // prop change" pattern, as in useDrivePreview) rather than in an effect.
  const listKey = `${debouncedQuery}\u0000${filterMode}\u0000${sortOrder}`;
  const [pager, setPager] = useState({ key: listKey, count: PAGE_SIZE });
  if (pager.key !== listKey) setPager({ key: listKey, count: PAGE_SIZE });
  const visibleCount = pager.key === listKey ? pager.count : PAGE_SIZE;

  const total = filteredFiles.length;
  const visibleFiles = useMemo(
    () => filteredFiles.slice(0, visibleCount),
    [filteredFiles, visibleCount],
  );

  // Infinite scroll. The observer is rebuilt on every page because a fresh
  // observe() re-reports the sentinel's current state: if the new page still
  // didn't push it out of range the next page loads immediately, and once it
  // does the callback simply stops firing.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPager((p) => (p.key === listKey ? { ...p, count: p.count + PAGE_SIZE } : p));
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, total, listKey]);

  const handleImport = useCallback(async (file: DriveFileIndex) => {
    if (importingId) return; // One import at a time.
    setImportingId(file.id);
    try {
      // User gesture: interactive token acquisition.
      await getDriveLibrarySync().importFile(file.id, file.name, undefined, { interactive: true });
      showToast(`Imported "${file.name}"`, 'success');
    } catch (error) {
      logger.error('Drive import failed', error);
      showToast(`Failed to import "${file.name}"`, 'error');
    } finally {
      setImportingId(null);
    }
  }, [importingId, showToast]);

  const handleRefresh = useCallback(async () => {
    try {
      await getDriveLibrarySync().scanAndIndex();
    } catch (error) {
      logger.error('Drive index refresh failed', error);
      showToast('Failed to refresh index', 'error');
    }
  }, [showToast]);

  const refreshButton = (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleRefresh}
      disabled={isScanning}
      data-testid="drive-refresh-button"
      className="gap-2 shrink-0"
    >
      {isScanning ? (
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
      )}
      {isScanning ? 'Scanning...' : 'Refresh'}
    </Button>
  );

  // No folder linked: the shelf has nothing to show and a scan cannot help —
  // send the user to the Drive settings that own the link.
  if (!linkedFolderId) {
    return (
      <section
        className="flex-1 w-full flex flex-col items-center justify-center py-16 text-center"
        data-testid="drive-view"
      >
        <div className="p-4 rounded-full bg-primary/10 text-primary mb-4">
          <Cloud className="w-10 h-10" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">No Drive folder linked</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Link a Google Drive folder to browse and import the EPUBs it holds.
        </p>
        <Button className="mt-6 gap-2" onClick={() => navigate('/settings/sync')}>
          <FolderSearch className="w-4 h-4" aria-hidden="true" />
          Link a folder
        </Button>
      </section>
    );
  }

  return (
    <div className="flex-1 w-full flex flex-col" data-testid="drive-view">
      {/* Controls row — mirrors the library's search/filter/sort row. */}
      <div className="flex flex-col gap-4 md:flex-row-reverse md:items-center md:justify-between mb-4">
        <div className="w-full md:w-72">
          <LibrarySearchBar
            ref={searchBarRef}
            onQueryChange={setDebouncedQuery}
            filteredCount={total}
            isFilteredEmpty={total === 0}
            placeholder="Search Drive files..."
            label="Search Drive files by filename"
            itemNoun="files"
            testId="drive-search-input"
          />
        </div>

        <div className="flex flex-row items-center justify-between gap-2 w-full md:w-auto">
          {/* Filter toggle */}
          <div className="flex items-center bg-muted/50 p-1 rounded-lg border shrink-0">
            <Button
              variant={filterMode === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilterMode('all')}
              className="h-7 px-2 sm:px-3 text-xs"
              data-testid="drive-filter-all"
            >
              All Files
            </Button>
            <Button
              variant={filterMode === 'new' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilterMode('new')}
              className="h-7 px-2 sm:px-3 text-xs"
              data-testid="drive-filter-new"
            >
              Not Imported
            </Button>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
            <span className="whitespace-nowrap hidden sm:inline">Sort by:</span>
            <Select value={sortOrder} onValueChange={(val) => setSortOrder(val as DriveSortOrder)}>
              <SelectTrigger
                className="w-[130px] sm:w-[180px] text-foreground text-xs sm:text-sm h-8 sm:h-10"
                data-testid="drive-sort-select"
                aria-label="Sort Drive files by"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently Modified</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="size">Size</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Index status */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-4 px-1">
        <span className="truncate">
          {index.length} file{index.length === 1 ? '' : 's'} indexed
          {linkedFolderName ? ` in ${linkedFolderName}` : ''} • Last scan{' '}
          {lastScanTime ? formatRelativeTime(lastScanTime) : 'never'}
        </span>
        {refreshButton}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {isScanning ? 'Scanning Google Drive' : ''}
      </div>

      {index.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center">
          <p className="text-lg">No indexed files yet</p>
          <p className="text-sm mt-1">Refresh the index to scan the linked folder.</p>
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-center">
          <p className="text-lg">
            {debouncedQuery
              ? `No files found matching "${debouncedQuery}"`
              : 'Every indexed file is already in your library'}
          </p>
          {debouncedQuery ? (
            <Button variant="link" onClick={() => searchBarRef.current?.clearSearch()} className="mt-2">
              Clear search
            </Button>
          ) : filterMode === 'new' ? (
            <Button variant="link" onClick={() => setFilterMode('all')} className="mt-2">
              Show all files
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6 w-full">
              {visibleFiles.map((file) => (
                <div key={file.id} className="flex justify-center">
                  <DriveBookCard
                    file={file}
                    inLibrary={libraryFilenames.has(file.name)}
                    importing={importingId === file.id}
                    disabled={!!importingId}
                    onImport={handleImport}
                    onOpenPreview={setPreviewFile}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 w-full">
              {visibleFiles.map((file) => (
                <DriveBookListItem
                  key={file.id}
                  file={file}
                  inLibrary={libraryFilenames.has(file.name)}
                  importing={importingId === file.id}
                  disabled={!!importingId}
                  onImport={handleImport}
                  onOpenPreview={setPreviewFile}
                />
              ))}
            </div>
          )}

          {/* Infinite-scroll sentinel */}
          {visibleCount < total && (
            <div
              ref={sentinelRef}
              data-testid="drive-scroll-sentinel"
              className="flex items-center justify-center py-8 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
              Loading more files ({visibleCount} of {total})
            </div>
          )}

          {/* Spacer for bottom navigation or just breathing room */}
          <div className="h-24" />
        </>
      )}

      <DrivePreviewSheet
        file={previewFile}
        importing={!!previewFile && importingId === previewFile.id}
        onClose={() => setPreviewFile(null)}
        onImport={(file) => { setPreviewFile(null); handleImport(file); }}
      />
    </div>
  );
};
