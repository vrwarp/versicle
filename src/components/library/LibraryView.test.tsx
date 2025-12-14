import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

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

// Mock useToastStore
vi.mock('../../store/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

describe('LibraryView', () => {
    const mockShowToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock useToastStore
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useToastStore as any).mockImplementation((selector: any) => {
            if (selector) return selector({ showToast: mockShowToast });
            return { showToast: mockShowToast };
        });

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
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('renders empty state', async () => {
        render(<LibraryView />);
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

        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('virtual-grid')).toBeInTheDocument();
        });

        expect(screen.getAllByTestId('book-card')).toHaveLength(2);
    });

    it('handles drag and drop import', async () => {
        const mockAddBook = vi.fn().mockResolvedValue(undefined);
        useLibraryStore.setState({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addBook: mockAddBook as any
        });

        render(<LibraryView />);
        const dropZone = screen.getByTestId('library-view');

        const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });

        fireEvent.drop(dropZone, {
            dataTransfer: {
                files: [file],
            },
        });

        await waitFor(() => {
            expect(mockAddBook).toHaveBeenCalledWith(file);
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('imported successfully'), 'success');
        });
    });

    it('handles drag and drop invalid file', async () => {
        const mockAddBook = vi.fn();
        useLibraryStore.setState({
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addBook: mockAddBook as any
        });

        render(<LibraryView />);
        const dropZone = screen.getByTestId('library-view');

        const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });

        fireEvent.drop(dropZone, {
            dataTransfer: {
                files: [file],
            },
        });

        await waitFor(() => {
            expect(mockAddBook).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Only .epub files'), 'error');
        });
    });
});
