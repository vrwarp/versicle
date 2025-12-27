import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

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
                { id: '1', title: 'Book 1', author: 'Author 1' } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '2', title: 'Book 2', author: 'Author 2' } as any
            ],
            viewMode: 'grid'
        });

        render(<LibraryView />);

        await waitFor(() => {
            expect(screen.getAllByTestId('book-card')).toHaveLength(2);
        });
    });

    it('filters books by search query', async () => {
        useLibraryStore.setState({
            books: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '2', title: '1984', author: 'George Orwell' } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '3', title: 'Brave New World', author: 'Aldous Huxley' } as any
            ],
            viewMode: 'grid'
        });

        render(<LibraryView />);

        const searchInput = screen.getByTestId('library-search-input');
        fireEvent.change(searchInput, { target: { value: 'George' } });

        await waitFor(() => {
            expect(screen.getAllByTestId('book-card')).toHaveLength(1);
            expect(screen.getByText('1984')).toBeInTheDocument();
        });

        fireEvent.change(searchInput, { target: { value: 'Great' } });

        await waitFor(() => {
            expect(screen.getAllByTestId('book-card')).toHaveLength(1);
            expect(screen.getByText('The Great Gatsby')).toBeInTheDocument();
        });
    });

    it('sorts books correctly', async () => {
        useLibraryStore.setState({
            books: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '1', title: 'B', author: 'Z', addedAt: 100, lastRead: 200 } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '2', title: 'A', author: 'Y', addedAt: 300, lastRead: 100 } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '3', title: 'C', author: 'X', addedAt: 200, lastRead: 300 } as any
            ],
            viewMode: 'grid'
        });

        render(<LibraryView />);
        const sortSelect = screen.getByTestId('sort-select');

        // Default: Recently Added (Newest first) -> 2 (300), 3 (200), 1 (100)
        let cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('A');
        expect(cards[1]).toHaveTextContent('C');
        expect(cards[2]).toHaveTextContent('B');

        // Sort by Title (A-Z) -> 2 (A), 1 (B), 3 (C)
        fireEvent.change(sortSelect, { target: { value: 'title' } });
        cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('A');
        expect(cards[1]).toHaveTextContent('B');
        expect(cards[2]).toHaveTextContent('C');

        // Sort by Author (A-Z) -> 3 (X), 2 (Y), 1 (Z)
        fireEvent.change(sortSelect, { target: { value: 'author' } });
        cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('C'); // Author X
        expect(cards[1]).toHaveTextContent('A'); // Author Y
        expect(cards[2]).toHaveTextContent('B'); // Author Z

        // Sort by Last Read (Most recent first) -> 3 (300), 1 (200), 2 (100)
        fireEvent.change(sortSelect, { target: { value: 'last_read' } });
        cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('C');
        expect(cards[1]).toHaveTextContent('B');
        expect(cards[2]).toHaveTextContent('A');
    });

    it('shows no results message when search returns nothing', async () => {
        useLibraryStore.setState({
            books: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' } as any
            ],
            viewMode: 'grid'
        });

        render(<LibraryView />);

        const searchInput = screen.getByTestId('library-search-input');
        fireEvent.change(searchInput, { target: { value: 'Harry Potter' } });

        await waitFor(() => {
            expect(screen.queryByTestId('book-card')).not.toBeInTheDocument();
            expect(screen.getByText('No books found matching "Harry Potter"')).toBeInTheDocument();
        });
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
