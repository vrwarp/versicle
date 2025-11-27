import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mock react-window
vi.mock('react-window', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FixedSizeGrid = ({ children, columnCount, rowCount }: any) => (
    <div data-testid="virtual-grid">
      {Array.from({ length: rowCount }).flatMap((_, r) =>
         Array.from({ length: columnCount }).map((_, c) =>
            // eslint-disable-next-line react/jsx-key
            <div key={`${r}-${c}`} style={{ left: 0 }}>
                {children({ columnIndex: c, rowIndex: r, style: { width: 100, height: 100, left: 0, top: 0 } })}
            </div>
         )
      )}
    </div>
  );
  return {
      FixedSizeGrid,
      default: { FixedSizeGrid }
  };
});

// Mock BookCard
vi.mock('./BookCard', () => ({
  BookCard: ({ book }: any) => <div data-testid="book-card">{book.title}</div>
}));

// Mock DragDropOverlay
vi.mock('./DragDropOverlay', () => ({
    DragDropOverlay: () => <div data-testid="drag-drop-overlay" />
}));

describe('LibraryView', () => {
    beforeEach(() => {
        vi.clearAllMocks();

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
        expect(screen.queryByTestId('virtual-grid')).not.toBeInTheDocument();
        // Spinner
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('renders empty state', async () => {
        render(<LibraryView />);
        // It calls fetchBooks on mount, which is mocked.
        // Should show empty state immediately.

        expect(screen.getByText(/Your library is empty/i)).toBeInTheDocument();
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
