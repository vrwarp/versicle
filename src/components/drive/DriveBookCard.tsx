import React from 'react';
import { Book, Check, Download, Loader2 } from 'lucide-react';
import { cn } from '@lib/utils';
import type { DriveFileIndex } from '@store/useDriveStore';
import { formatBytes } from '@kernel/locale/format';
import { Button } from '../ui/Button';
import { useDrivePreview } from './useDrivePreview';
import { useInView } from './useInView';

export interface DriveShelfItemProps {
  file: DriveFileIndex;
  /** The library already holds a book imported from this Drive filename. */
  inLibrary: boolean;
  importing: boolean;
  disabled: boolean;
  onImport: (file: DriveFileIndex) => void;
  onOpenPreview: (file: DriveFileIndex) => void;
}

/**
 * Grid tile for one Drive file — the shelf's counterpart to the library's
 * BookCard, deliberately built to the same geometry (2:3 cover, 240px cap,
 * title/author block) so switching contexts in the header dropdown doesn't
 * reflow the page under the user.
 *
 * Cover + verified title/author come from the Drive preview cache, hydrated
 * lazily once the tile scrolls into view (the fetch is cancelled on scroll-out
 * by the hook's AbortSignal). With no preview available it degrades to the
 * filename + size — never a broken tile.
 */
export const DriveBookCard: React.FC<DriveShelfItemProps> = React.memo(({
  file,
  inLibrary,
  importing,
  disabled,
  onImport,
  onOpenPreview,
}) => {
  const [ref, inView] = useInView<HTMLDivElement>();
  const preview = useDrivePreview(file.id, { enabled: inView, priority: 'viewport' });
  const title = preview.title || file.name;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      onOpenPreview(file);
    }
  };

  return (
    <div
      ref={ref}
      onClick={() => onOpenPreview(file)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-testid={`drive-card-${file.id}`}
      className="group flex flex-col bg-card text-card-foreground rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-border h-full cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full max-w-[240px]"
    >
      <div className="relative">
        <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden shadow-inner flex items-center justify-center">
          {preview.coverUrl ? (
            <img
              src={preview.coverUrl}
              alt={`Cover of ${title}`}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
          ) : preview.loading ? (
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/60" aria-hidden="true" />
          ) : (
            <Book className="w-10 h-10 text-muted-foreground/50" aria-hidden="true" />
          )}
        </div>

        {inLibrary && (
          <span className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-background/80 backdrop-blur-sm px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-sm">
            <Check className="w-3 h-3" aria-hidden="true" />
            In library
          </span>
        )}

        {/* Import affordance — always visible on touch, on hover/focus elsewhere
            (the same disclosure rule as the library card's action menu). */}
        <div className="absolute top-2 right-2 z-20 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full shadow-md bg-background/80 backdrop-blur-sm"
            onClick={(e) => { e.stopPropagation(); onImport(file); }}
            disabled={disabled}
            data-testid={`drive-import-${file.id}`}
            aria-label={`Import ${title}`}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      <div className="p-3 flex flex-col flex-1">
        {/* lang: book-sourced text carries the CONTENT language (i18n ADR §3) */}
        <h3
          lang={preview.language}
          className="font-semibold text-foreground line-clamp-2 mb-1"
          title={title}
        >
          {title}
        </h3>
        <p
          lang={preview.author ? preview.language : undefined}
          className={cn('text-sm text-muted-foreground line-clamp-1', !preview.author && 'italic')}
          title={preview.author}
        >
          {preview.author || 'Unknown Author'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{formatBytes(file.size)}</p>
      </div>
    </div>
  );
});
DriveBookCard.displayName = 'DriveBookCard';
