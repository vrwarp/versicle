import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mock react-window
vi.mock('react-window', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Grid: ({ cellComponent: Cell, cellProps, columnCount, rowCount }: any) => (
    <div data-testid="virtual-grid">
      {Array.from({ length: rowCount }).flatMap((_, r) =>
         Array.from({ length: columnCount }).map((_, c) =>
            <div key={`${r}-${c}`}>
                <Cell columnIndex={c} rowIndex={r} style={{ width: 100, height: 100 }} {...cellProps} />
            </div>
         )
      )}
    </div>
  )
}));

// Mock BookCard
vi.mock('./BookCard', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BookCard: ({ book }: any) => <div data-testid="book-card">{book.title}</div>
}));

// Mock EmptyLibrary
vi.mock('./EmptyLibrary', () => ({
    EmptyLibrary: () => <div data-testid="empty-library">Empty Library</div>
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        expect(screen.getByTestId('empty-library')).toBeInTheDocument();
    });

    it('renders grid with books', async () => {
        useLibraryStore.setState({
            books: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '1', title: 'Book 1' } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
