/**
 * DrivePreviewSheet (R3) — the canonical pre-import preview. Shows the cover,
 * verified title/author/description/language and size for a Drive file before
 * the user commits to a full download+import. Metadata comes from the
 * partial-fetch preview service (a few ranged reads); a fetch failure degrades
 * to filename + size (never blocks import).
 *
 * The detected language is shown as an editable-looking suggestion, never a
 * silent config change. The dedup line is informational — it never blocks an
 * import, because EPUB identifiers/titles are too unreliable to gate on — but
 * it does say WHICH outcome is coming: a filename already in the library is
 * the one signal the import pipeline itself acts on (Replace), while a
 * title-only match still adds a separate entry.
 */
import React, { useMemo } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Book, Download, Loader2 } from 'lucide-react';
import type { DriveFileIndex } from '@store/useDriveStore';
import { useBookStore } from '@store/useBookStore';
import { formatBytes, formatDate } from '@kernel/locale/format';
import { useDrivePreview } from './useDrivePreview';

interface DrivePreviewSheetProps {
  file: DriveFileIndex | null;
  onClose: () => void;
  onImport: (file: DriveFileIndex) => void;
  importing?: boolean;
}

interface LibraryMatch {
  /** "Title — Author" of the book already held. */
  label: string;
  /**
   * The match is on the SOURCE FILENAME — the same key
   * `ImportOrchestrator.findExistingBookIdByFilename` gates on, so importing
   * this file will land on the Replace prompt rather than adding a new book.
   */
  byFilename: boolean;
}

/**
 * Best-effort dedup hint. Two signals, deliberately distinguished because they
 * lead to different outcomes:
 *
 *  - **Filename** — authoritative. It is exactly what the import gate checks,
 *    so a hit here means the import resolves to Replace, not a second copy.
 *  - **Title** — advisory. The same book under a different filename imports
 *    cleanly as a separate entry, which the user may or may not want.
 *
 * Neither blocks the import; the sheet only states which one is about to
 * happen (the previous title-only hint promised "import anyway?" even when the
 * pipeline was about to refuse a plain add).
 */
function useLibraryMatch(filename?: string, title?: string): LibraryMatch | undefined {
  const books = useBookStore((s) => s.books);
  return useMemo(() => {
    const describe = (bookTitle?: string, bookAuthor?: string) =>
      bookAuthor ? `${bookTitle} — ${bookAuthor}` : bookTitle || 'Untitled';

    if (filename) {
      for (const book of Object.values(books)) {
        if (book.sourceFilename === filename) {
          return { label: describe(book.title, book.author), byFilename: true };
        }
      }
    }

    if (!title) return undefined;
    const normalized = title.trim().toLowerCase();
    for (const book of Object.values(books)) {
      if (book.title?.trim().toLowerCase() === normalized) {
        return { label: describe(book.title, book.author), byFilename: false };
      }
    }
    return undefined;
  }, [books, filename, title]);
}

export const DrivePreviewSheet: React.FC<DrivePreviewSheetProps> = ({
  file,
  onClose,
  onImport,
  importing = false,
}) => {
  const preview = useDrivePreview(file?.id, { priority: 'interactive', interactive: true });
  const match = useLibraryMatch(file?.name, preview.title);

  const displayTitle = preview.title || file?.name || 'Untitled';

  return (
    <Modal open={!!file} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className="sm:max-w-md">
        <ModalHeader>
          <ModalTitle>Preview</ModalTitle>
          <ModalDescription>Review this book before importing it.</ModalDescription>
        </ModalHeader>

        <div className="flex gap-4 py-2">
          <div className="w-24 h-36 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center border">
            {preview.coverUrl ? (
              <img
                src={preview.coverUrl}
                alt={`Cover of ${displayTitle}`}
                className="w-full h-full object-cover"
              />
            ) : preview.loading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
              <Book className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-semibold text-foreground leading-snug break-words">{displayTitle}</p>
            {preview.author && (
              <p className="text-sm text-muted-foreground break-words">{preview.author}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {file ? formatBytes(file.size) : ''} {file ? `• ${formatDate(file.modifiedTime)}` : ''}
            </p>
            {preview.language && (
              <p className="text-xs text-muted-foreground">Language: {preview.language}</p>
            )}
            {preview.needsAuth && (
              <p className="text-xs text-amber-600">Reconnect Google Drive to load the preview.</p>
            )}
          </div>
        </div>

        {preview.description && (
          <p className="text-sm text-muted-foreground max-h-28 overflow-y-auto border-t pt-3">
            {preview.description}
          </p>
        )}

        {match && (
          <p className="text-xs text-amber-600 border-t pt-3" data-testid="drive-preview-dedup">
            {match.byFilename
              ? `“${match.label}” is already in your library — importing asks whether to replace it (your progress and notes are kept).`
              : `Looks like “${match.label}” is already in your library — import anyway?`}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={() => file && onImport(file)} disabled={importing || !file}>
            {importing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            )}
            Import
          </Button>
        </div>

        <p className="sr-only" aria-live="polite">
          {preview.loading ? 'Loading preview' : preview.status === 'ok' ? 'Preview ready' : ''}
        </p>
      </ModalContent>
    </Modal>
  );
};
