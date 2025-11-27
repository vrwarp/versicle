import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mock react-window
vi.mock('react-window', () => ({
  FixedSizeGrid: ({ children, columnCount, rowCount }: any) => (
    <div data-testid="virtual-grid">
      {Array.from({ length: rowCount }).flatMap((_, r) =>
         Array.from({ length: columnCount }).map((_, c) =>
            // eslint-disable-next-line react/jsx-key
            <div key={`${r}-${c}`}>
                {children({ columnIndex: c, rowIndex: r, style: { width: 100, height: 100 } })}
            </div>
         )
      )}
    </div>
  )
}));

// Mock BookCard
vi.mock('./BookCard', () => ({
  BookCard: ({ book }: any) => <div data-testid="book-card">{book.title}</div>
}));

// Mock FileUploader
vi.mock('./FileUploader', () => ({
    FileUploader: () => <div data-testid="file-uploader">Upload</div>
}));

// Mock IDB via fake-indexeddb is usually handled globally or we mock getDB
// But since we are testing View, we can mock the store action fetchBooks to avoid DB calls.
// The store uses `getDB` which is async.

describe('LibraryView', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Mock fetchBooks to avoid real DB and async state issues in test
        // We override the fetchBooks method in the store for tests
        // But zustand store is a singleton.

        // Better: Mock `useLibraryStore` partially?
        // Or just mock `fetchBooks` to be a no-op or controlled.

        // Since `useLibraryStore` is imported, we can mock the module,
        // but it's harder with zustand.

        // Let's rely on setState, but overwrite fetchBooks in the state temporarily?
        useLibraryStore.setState({
            books: [],
            isLoading: false,
            error: null,
            fetchBooks: vi.fn().mockResolvedValue(undefined) as any
        });

        // Mock getBoundingClientRect and offsetWidth
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1000 });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ top: 100 })
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    });

    it('renders loading state', () => {
        useLibraryStore.setState({ isLoading: true });
        render(<LibraryView />);
        expect(screen.getByTestId('file-uploader')).toBeInTheDocument();
        expect(screen.queryByTestId('virtual-grid')).not.toBeInTheDocument();
        // Spinner
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('renders empty state', async () => {
        render(<LibraryView />);
        // It calls fetchBooks on mount, which is mocked.
        // Should show empty state immediately.

        expect(screen.getByText(/No books yet/i)).toBeInTheDocument();
    });

    it('renders grid with books', async () => {
        useLibraryStore.setState({
            books: [
                { id: '1', title: 'Book 1' } as any,
                { id: '2', title: 'Book 2' } as any
            ]
        });

        render(<LibraryView />);

        // Ensure useLayoutEffect runs and sets dimensions
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('virtual-grid')).toBeInTheDocument();
        });

        expect(screen.getAllByTestId('book-card')).toHaveLength(2);
    });
});
