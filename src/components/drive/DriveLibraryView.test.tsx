import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DriveLibraryView } from './DriveLibraryView';
import { useDriveStore } from '@store/useDriveStore';
import { useBookStore } from '@store/useBookStore';
import { useToastStore } from '@store/useToastStore';
import { GoogleAuthRequiredError } from '@domains/google/auth/errors';
import type { DriveFileIndex } from '@store/useDriveStore';

const { driveSync, metadataService } = vi.hoisted(() => ({
  driveSync: { scanAndIndex: vi.fn(), importFile: vi.fn() },
  metadataService: { getPreview: vi.fn(), getCached: vi.fn() },
}));

// The shelf talks to the domain holder directly (the DriveScannerService
// façade died in P9), exactly as the dialog it replaces did.
vi.mock('@domains/google/drive/holder', () => ({
  getDriveClient: vi.fn(),
  setDriveClient: vi.fn(),
  getDriveLibrarySync: vi.fn(() => driveSync),
  setDriveLibrarySync: vi.fn(),
  getDriveMetadataService: vi.fn(() => metadataService),
  setDriveMetadataService: vi.fn(),
  resetDriveHoldersForTesting: vi.fn(),
}));

vi.mock('@store/useDriveStore', () => ({ useDriveStore: vi.fn() }));
vi.mock('@store/useBookStore', () => ({ useBookStore: vi.fn() }));
vi.mock('@store/useToastStore', () => ({ useToastStore: vi.fn() }));

interface DriveStoreState {
  index: DriveFileIndex[];
  lastScanTime: number | null;
  isScanning: boolean;
  linkedFolderId: string | null;
  linkedFolderName: string | null;
}

interface FakeObserver {
  callback: IntersectionObserverCallback;
  targets: Element[];
}

/** Live fake observers, so a test can decide exactly what "scrolls into view". */
const observers: FakeObserver[] = [];

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  private readonly entry: FakeObserver;

  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element): void {
    this.entry.targets.push(el);
  }
  unobserve(el: Element): void {
    this.entry.targets = this.entry.targets.filter((t) => t !== el);
  }
  disconnect(): void {
    const i = observers.indexOf(this.entry);
    if (i >= 0) observers.splice(i, 1);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Report an intersection for every observed element matching `match`. */
function scrollIntoView(match: (el: Element) => boolean): void {
  for (const observer of observers.slice()) {
    const hits = observer.targets.filter(match);
    if (hits.length === 0) continue;
    observer.callback(
      hits.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
      null as unknown as IntersectionObserver,
    );
  }
}

const isSentinel = (el: Element) => el.getAttribute('data-testid') === 'drive-scroll-sentinel';

function makeFiles(count: number, prefix = 'Book'): DriveFileIndex[] {
  const idPrefix = prefix === 'Book' ? 'file' : prefix.toLowerCase();
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    name: `${prefix} ${String(i).padStart(3, '0')}.epub`,
    size: 1000 + i,
    // Descending modifiedTime so index order and 'recent' order agree.
    modifiedTime: `2026-01-${String(28 - (i % 28)).padStart(2, '0')}T00:00:00.000Z`,
    mimeType: 'application/epub+zip',
  }));
}

const mockShowToast = vi.fn();

function setDriveState(overrides: Partial<DriveStoreState> = {}): void {
  const state: DriveStoreState = {
    index: [],
    lastScanTime: 1700000000000,
    isScanning: false,
    linkedFolderId: 'folder-1',
    linkedFolderName: 'Books',
    ...overrides,
  };
  (useDriveStore as unknown as Mock).mockImplementation(
    (selector: (s: DriveStoreState) => unknown) => selector(state),
  );
}

function setLibraryBooks(books: Record<string, { sourceFilename?: string }>): void {
  (useBookStore as unknown as Mock).mockImplementation(
    (selector: (s: { books: Record<string, { sourceFilename?: string }> }) => unknown) =>
      selector({ books }),
  );
}

function renderShelf(viewMode: 'grid' | 'list' = 'grid') {
  return render(<DriveLibraryView viewMode={viewMode} />, { wrapper: MemoryRouter });
}

describe('DriveLibraryView', () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  beforeEach(() => {
    vi.clearAllMocks();
    observers.length = 0;
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    metadataService.getPreview.mockResolvedValue({ status: 'error' });
    driveSync.importFile.mockResolvedValue(undefined);
    driveSync.scanAndIndex.mockResolvedValue(undefined);
    setDriveState();
    setLibraryBooks({});
    (useToastStore as unknown as Mock).mockImplementation(
      (selector: (s: { showToast: typeof mockShowToast }) => unknown) =>
        selector({ showToast: mockShowToast }),
    );
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  // ── absorbed from the retired DriveImportDialog suite ─────────────────────
  describe('index refresh', () => {
    it('renders the refresh control', () => {
      renderShelf();
      expect(screen.getByTestId('drive-refresh-button')).toHaveTextContent('Refresh');
    });

    it('calls scanAndIndex interactively when refresh is clicked (user gesture may reprompt sign-in)', () => {
      renderShelf();
      fireEvent.click(screen.getByTestId('drive-refresh-button'));
      expect(driveSync.scanAndIndex).toHaveBeenCalledWith({ interactive: true });
    });

    it('regression: an auth failure surfaces a reconnect toast, not a generic one', async () => {
      driveSync.scanAndIndex.mockRejectedValue(
        new GoogleAuthRequiredError('drive', 'no-credential'),
      );
      renderShelf();
      fireEvent.click(screen.getByTestId('drive-refresh-button'));
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Google Drive needs to be reconnected. Sign in and try again.',
          'error',
        );
      });
    });

    it('shows the scanning state while a scan is in flight', () => {
      setDriveState({ isScanning: true });
      renderShelf();
      const button = screen.getByTestId('drive-refresh-button');
      expect(button).toHaveTextContent('Scanning...');
      expect(button).toBeDisabled();
    });
  });

  describe('empty states', () => {
    it('offers to link a folder when none is linked', () => {
      setDriveState({ linkedFolderId: null, linkedFolderName: null });
      renderShelf();
      expect(screen.getByText('No Drive folder linked')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Link a folder' })).toBeInTheDocument();
      expect(screen.queryByTestId('drive-refresh-button')).not.toBeInTheDocument();
    });

    it('points at the refresh control when the index is empty', () => {
      renderShelf();
      expect(screen.getByText('No indexed files yet')).toBeInTheDocument();
    });
  });

  describe('layouts', () => {
    it('renders the grid layout', () => {
      setDriveState({ index: makeFiles(3) });
      renderShelf('grid');
      expect(screen.getAllByTestId(/^drive-card-/)).toHaveLength(3);
      expect(screen.queryAllByTestId(/^drive-list-item-/)).toHaveLength(0);
    });

    it('renders the list layout', () => {
      setDriveState({ index: makeFiles(3) });
      renderShelf('list');
      expect(screen.getAllByTestId(/^drive-list-item-/)).toHaveLength(3);
      expect(screen.queryAllByTestId(/^drive-card-/)).toHaveLength(0);
    });

    it('falls back to the filename when no preview is cached', () => {
      setDriveState({ index: makeFiles(1) });
      renderShelf('list');
      expect(screen.getByText('Book 000.epub')).toBeInTheDocument();
    });
  });

  describe('infinite scroll', () => {
    it('renders only the first page up front', () => {
      setDriveState({ index: makeFiles(60) });
      renderShelf();
      expect(screen.getAllByTestId(/^drive-card-/)).toHaveLength(24);
      expect(screen.getByTestId('drive-scroll-sentinel')).toBeInTheDocument();
    });

    it('appends a page each time the sentinel scrolls into view', () => {
      setDriveState({ index: makeFiles(60) });
      renderShelf();

      act(() => scrollIntoView(isSentinel));
      expect(screen.getAllByTestId(/^drive-card-/)).toHaveLength(48);

      act(() => scrollIntoView(isSentinel));
      expect(screen.getAllByTestId(/^drive-card-/)).toHaveLength(60);
      // Everything is rendered — the sentinel retires rather than looping.
      expect(screen.queryByTestId('drive-scroll-sentinel')).not.toBeInTheDocument();
    });

    it('restarts paging when the filter changes', async () => {
      setDriveState({ index: makeFiles(60) });
      renderShelf();
      act(() => scrollIntoView(isSentinel));
      expect(screen.getAllByTestId(/^drive-card-/)).toHaveLength(48);

      fireEvent.change(screen.getByTestId('drive-search-input'), { target: { value: 'Book' } });
      await waitFor(() => {
        expect(screen.getAllByTestId(/^drive-card-/)).toHaveLength(24);
      });
    });
  });

  describe('filtering', () => {
    it('searches by filename', async () => {
      setDriveState({ index: [...makeFiles(2, 'Dune'), ...makeFiles(2, 'Neuromancer')] });
      renderShelf('list');
      expect(screen.getAllByTestId(/^drive-list-item-/)).toHaveLength(4);

      fireEvent.change(screen.getByTestId('drive-search-input'), { target: { value: 'neuro' } });
      await waitFor(() => {
        expect(screen.getAllByTestId(/^drive-list-item-/)).toHaveLength(2);
      });
      expect(screen.getByText('Neuromancer 000.epub')).toBeInTheDocument();
    });

    it('hides already-imported files behind the "Not Imported" filter', () => {
      setDriveState({ index: makeFiles(3) });
      setLibraryBooks({ b1: { sourceFilename: 'Book 001.epub' } });
      renderShelf('list');

      // The already-imported file is flagged, not hidden, by default.
      expect(screen.getAllByTestId(/^drive-list-item-/)).toHaveLength(3);
      expect(screen.getAllByText('In library')).toHaveLength(1);

      fireEvent.click(screen.getByTestId('drive-filter-new'));
      expect(screen.getAllByTestId(/^drive-list-item-/)).toHaveLength(2);
      expect(screen.queryByTestId('drive-list-item-file-1')).not.toBeInTheDocument();
    });
  });

  describe('import', () => {
    it('imports a file interactively and reports success', async () => {
      setDriveState({ index: makeFiles(1) });
      renderShelf('list');

      fireEvent.click(screen.getByTestId('drive-import-file-0'));

      await waitFor(() => {
        expect(driveSync.importFile).toHaveBeenCalledWith(
          'file-0',
          'Book 000.epub',
          undefined,
          { interactive: true },
        );
      });
      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Imported "Book 000.epub"', 'success');
      });
    });

    it('reports a failed import without breaking the shelf', async () => {
      setDriveState({ index: makeFiles(1) });
      driveSync.importFile.mockRejectedValue(new Error('boom'));
      renderShelf('list');

      fireEvent.click(screen.getByTestId('drive-import-file-0'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('Failed to import "Book 000.epub"', 'error');
      });
      expect(screen.getByTestId('drive-list-item-file-0')).toBeInTheDocument();
    });

    it('regression: an auth failure during import asks for a reconnect', async () => {
      setDriveState({ index: makeFiles(1) });
      driveSync.importFile.mockRejectedValue(
        new GoogleAuthRequiredError('drive', 'connect-failed', new Error('Popup closed')),
      );
      renderShelf('list');

      fireEvent.click(screen.getByTestId('drive-import-file-0'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'Google Drive needs to be reconnected. Sign in and try again.',
          'error',
        );
      });
    });
  });
});
