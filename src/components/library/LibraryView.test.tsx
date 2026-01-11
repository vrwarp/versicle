import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useInventoryStore } from '../../store/useInventoryStore';
import { useProgressStore } from '../../store/useProgressStore';
import { useToastStore } from '../../store/useToastStore';
import { MemoryRouter } from 'react-router-dom';

// Mock BookCard
vi.mock('./BookCard', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    BookCard: ({ book }: any) => <div data-testid="book-card">{book.title}</div>
}));

// Mock EmptyLibrary
vi.mock('./EmptyLibrary', () => ({
    EmptyLibrary: () => <div data-testid="empty-library">Empty Library</div>
}));

// Mock ReprocessingInterstitial
vi.mock('./ReprocessingInterstitial', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReprocessingInterstitial: ({ isOpen }: any) => isOpen ? <div data-testid="reprocessing-interstitial">Processing...</div> : null
}));

// Mock useToastStore
vi.mock('../../store/useToastStore', () => ({
    useToastStore: vi.fn(),
}));

// Mock Select components
vi.mock('../ui/Select', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Select: ({ value, onValueChange, children }: any) => (
        <select
            data-testid="sort-select"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
        >
            {children}
        </select>
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SelectTrigger: ({ children }: any) => <>{children}</>,
    SelectValue: () => null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SelectContent: ({ children }: any) => <>{children}</>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SelectItem: ({ value, children }: any) => (
        <option value={value}>{children}</option>
    ),
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
            error: null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fetchBooks: vi.fn().mockResolvedValue(undefined) as any
        });
        useInventoryStore.setState({ books: {} });

        // Mock getBoundingClientRect and offsetWidth
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1000 });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ top: 100 })
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    });

    // it('renders loading state', () => {
    //     // Loading state is no longer managed via simple boolean in store for LibraryView
    // });

    it('renders empty state', async () => {
        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );
        expect(screen.getByTestId('empty-library')).toBeInTheDocument();
    });

    it('renders grid with books', async () => {
        useInventoryStore.setState({
            books: {
                '1': { bookId: '1', customTitle: 'Book 1', customAuthor: 'Author 1', addedAt: 100 } as any,
                '2': { bookId: '2', customTitle: 'Book 2', customAuthor: 'Author 2', addedAt: 100 } as any
            }
        });
        useLibraryStore.setState({ viewMode: 'grid' });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('book-card')).toHaveLength(2);
        });
    });

    it('filters books by search query', async () => {
        useInventoryStore.setState({
            books: {
                '1': { bookId: '1', customTitle: 'The Great Gatsby', customAuthor: 'F. Scott Fitzgerald' } as any,
                '2': { bookId: '2', customTitle: '1984', customAuthor: 'George Orwell' } as any,
                '3': { bookId: '3', customTitle: 'Brave New World', customAuthor: 'Aldous Huxley' } as any
            }
        });
        useLibraryStore.setState({ viewMode: 'grid' });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

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
        // Note: LibraryView sorts based on derived BookMetadata.
        // We simulate that by setting Inventory items.
        // For lastRead sorting, we need ProgressStore too, but let's assume LibraryView falls back to addedAt if lastRead missing?
        // Wait, the test expects last_read sorting. We need useProgressStore mock if we want lastRead.
        // But for this refactor, let's just fix the inventory part first.
        // Actually, LibraryView derives lastRead from ProgressStore.
        // I should stick to 'recent' (addedAt) or 'alpha' (title/author) if I don't want to mock progress store.
        // But the test cases sort by lastRead.
        // So I should mock ProgressStore too or just skip lastRead part?
        // Let's set Inventory properties first.
        useInventoryStore.setState({
            books: {
                '1': { bookId: '1', customTitle: 'B', customAuthor: 'Z', addedAt: 100 } as any,
                '2': { bookId: '2', customTitle: 'A', customAuthor: 'Y', addedAt: 300 } as any,
                '3': { bookId: '3', customTitle: 'C', customAuthor: 'X', addedAt: 200 } as any
            }
        });

        useProgressStore.setState({
            progress: {
                '1': { bookId: '1', percentage: 0, lastRead: 200 } as any,
                '2': { bookId: '2', percentage: 0, lastRead: 100 } as any,
                '3': { bookId: '3', percentage: 0, lastRead: 300 } as any
            }
        });
        useLibraryStore.setState({ viewMode: 'grid', sortOrder: 'recent' });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );
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
        useInventoryStore.setState({
            books: {
                '1': { bookId: '1', customTitle: 'The Great Gatsby', customAuthor: 'F. Scott Fitzgerald' } as any
            }
        });
        useLibraryStore.setState({ viewMode: 'grid' });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

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

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );
        const dropZone = screen.getByTestId('library-view');

        const file = new File(['dummy'], 'test.epub', { type: 'application/epub+zip' });

        fireEvent.drop(dropZone, {
            dataTransfer: {
                files: [file],
            },
        });

        await waitFor(() => {
            expect(mockAddBook).toHaveBeenCalledWith(file);
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('imported successfully'), 'success', 5000);
        });
    });

    it('handles drag and drop invalid file', async () => {
        const mockAddBook = vi.fn();
        useLibraryStore.setState({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addBook: mockAddBook as any
        });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );
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

    it('triggers reprocessing workflow when redirect state is present', async () => {
        render(
            <MemoryRouter initialEntries={[{ pathname: '/', state: { reprocessBookId: 'book-123' } }]}>
                <LibraryView />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('reprocessing-interstitial')).toBeInTheDocument();
        });
    });

    it('clears reprocessing state after triggering', async () => {
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

        render(
            <MemoryRouter initialEntries={[{ pathname: '/', state: { reprocessBookId: 'book-123' } }]}>
                <LibraryView />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(replaceStateSpy).toHaveBeenCalledWith({}, expect.any(String));
        });
    });
});
