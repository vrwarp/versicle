import React from 'react';
import { Book, Check, Download, Loader2 } from 'lucide-react';
import { cn } from '@lib/utils';
import { formatBytes, formatDate } from '@kernel/locale/format';
import { Button } from '../ui/Button';
import type { DriveShelfItemProps } from './DriveBookCard';
import { useDrivePreview } from './useDrivePreview';
import { useInView } from './useInView';

/**
 * List row for one Drive file — the shelf's counterpart to the library's
 * BookListItem, sharing its geometry (40×56 thumbnail, single-line title, a
 * bullet-separated meta line) so the grid/list toggle behaves identically in
 * both contexts.
 *
 * Same lazy hydration contract as {@link DriveBookCard}: the preview fetch
 * starts when the row scrolls into view and degrades to filename + size.
 */
export const DriveBookListItem: React.FC<DriveShelfItemProps> = React.memo(({
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

  return (
    <div ref={ref} className="px-4 py-2" data-testid={`drive-list-item-${file.id}`}>
      <div
        className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group h-full border border-transparent hover:border-border"
        onClick={() => onOpenPreview(file)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            onOpenPreview(file);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {/* Thumbnail */}
        <div className="flex-none w-10 h-14 bg-muted rounded overflow-hidden shadow-sm relative flex items-center justify-center">
          {preview.coverUrl ? (
            <img src={preview.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : preview.loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/60" aria-hidden="true" />
          ) : (
            <Book className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {/* lang: book-sourced text carries the CONTENT language (i18n ADR §3) */}
          <h3
            lang={preview.language}
            className="text-sm font-semibold truncate text-foreground pr-2"
            title={title}
          >
            {title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 truncate">
            {preview.author && (
              <>
                <span lang={preview.language} className="truncate max-w-[150px]">
                  {preview.author}
                </span>
                <span>•</span>
              </>
            )}
            <span>{formatBytes(file.size)}</span>
            <span>•</span>
            <span className="truncate">{formatDate(file.modifiedTime)}</span>
            {inLibrary && (
              <span className="text-blue-500 font-medium ml-1 flex items-center gap-1 shrink-0">
                <Check className="w-3 h-3" aria-hidden="true" />
                In library
              </span>
            )}
          </div>
        </div>

        {/* Actions — the button stops propagation itself, so the row's own
            click handler doesn't also fire the preview sheet. */}
        <div className="flex-none">
          <Button
            size="sm"
            variant={importing ? 'ghost' : 'secondary'}
            onClick={(e) => { e.stopPropagation(); onImport(file); }}
            disabled={disabled}
            data-testid={`drive-import-${file.id}`}
            aria-label={`Import ${title}`}
            className={cn('shrink-0', 'touch-manipulation')}
          >
            {importing ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <>
                <Download className="w-4 h-4 sm:mr-2" aria-hidden="true" />
                <span className="hidden sm:inline">Import</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
DriveBookListItem.displayName = 'DriveBookListItem';
