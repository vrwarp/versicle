import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { DrivePreviewSheet } from './DrivePreviewSheet';
import { useBookStore } from '@store/useBookStore';
import { useDrivePreview } from './useDrivePreview';
import type { DriveFileIndex } from '@store/useDriveStore';

vi.mock('@store/useBookStore', () => ({ useBookStore: vi.fn() }));
vi.mock('./useDrivePreview', () => ({ useDrivePreview: vi.fn() }));

const FILE: DriveFileIndex = {
  id: 'file-1',
  name: 'Matthew C. Bingham - A Heart Aflame for God.epub',
  size: 572800,
  modifiedTime: '2026-08-01T00:00:00.000Z',
  mimeType: 'application/epub+zip',
};

interface LibraryBook {
  bookId: string;
  title?: string;
  author?: string;
  sourceFilename?: string;
}

function setLibraryBooks(books: Record<string, LibraryBook>): void {
  (useBookStore as unknown as Mock).mockImplementation(
    (selector: (s: { books: Record<string, LibraryBook> }) => unknown) => selector({ books }),
  );
}

function setPreview(overrides: Partial<{ title: string; author: string }> = {}): void {
  (useDrivePreview as unknown as Mock).mockReturnValue({
    status: 'ok',
    loading: false,
    needsAuth: false,
    ...overrides,
  });
}

function renderSheet() {
  return render(
    <DrivePreviewSheet file={FILE} onClose={vi.fn()} onImport={vi.fn()} />,
  );
}

describe('DrivePreviewSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLibraryBooks({});
    setPreview();
  });

  it('shows no dedup hint when the library holds nothing similar', () => {
    setPreview({ title: 'A Heart Aflame for God', author: 'Matthew C. Bingham' });
    renderSheet();
    expect(screen.queryByTestId('drive-preview-dedup')).not.toBeInTheDocument();
  });

  // The import gate is findExistingBookIdByFilename, so a sourceFilename hit is
  // the one signal that predicts the outcome: the shelf will offer Replace. The
  // old copy said "import anyway?" here and the import then failed outright.
  it('warns that a filename match will ask to replace', () => {
    setLibraryBooks({
      b1: {
        bookId: 'b1',
        title: 'A Heart Aflame for God',
        author: 'Matthew C. Bingham',
        sourceFilename: FILE.name,
      },
    });
    setPreview({ title: 'A Heart Aflame for God', author: 'Matthew C. Bingham' });
    renderSheet();

    expect(screen.getByTestId('drive-preview-dedup')).toHaveTextContent(
      '“A Heart Aflame for God — Matthew C. Bingham” is already in your library — importing asks whether to replace it (your progress and notes are kept).',
    );
  });

  // Same book, different filename: the import really does add a second entry,
  // so "import anyway?" is the honest question.
  it('keeps the softer "import anyway?" hint for a title-only match', () => {
    setLibraryBooks({
      b1: {
        bookId: 'b1',
        title: 'A Heart Aflame for God',
        author: 'Matthew C. Bingham',
        sourceFilename: 'a-heart-aflame.epub',
      },
    });
    setPreview({ title: 'A Heart Aflame for God', author: 'Matthew C. Bingham' });
    renderSheet();

    expect(screen.getByTestId('drive-preview-dedup')).toHaveTextContent(
      'Looks like “A Heart Aflame for God — Matthew C. Bingham” is already in your library — import anyway?',
    );
  });

  it('still hints on a filename match when the preview metadata never loaded', () => {
    setLibraryBooks({
      b1: { bookId: 'b1', title: 'A Heart Aflame for God', sourceFilename: FILE.name },
    });
    setPreview(); // no title/author — the ranged fetch failed
    renderSheet();

    expect(screen.getByTestId('drive-preview-dedup')).toHaveTextContent(
      '“A Heart Aflame for God” is already in your library',
    );
  });
});
