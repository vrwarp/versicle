import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { MemoryRouter } from 'react-router-dom';

// Mock zustand/middleware to disable persistence
vi.mock('zustand/middleware', () => ({
    persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
    createJSONStorage: () => ({
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    }),
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

// Mock ReprocessingInterstitial
vi.mock('./ReprocessingInterstitial', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReprocessingInterstitial: ({ isOpen }: any) => isOpen ? <div data-testid="reprocessing-interstitial">Processing...</div> : null
}));

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

vi.mock('../../store/useReadingStateStore', () => {
    const mockStore = vi.fn((selector) => selector ? selector({ progress: {} }) : { progress: {} });
    mockStore.getState = vi.fn().mockReturnValue({ progress: {} });
    mockStore.setState = vi.fn();
    mockStore.subscribe = vi.fn();
    return {
        useReadingStateStore: mockStore
    };
});
import { useReadingStateStore } from '../../store/useReadingStateStore';

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
            books: {},
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

    it('sorts books correctly', async () => {
        useLibraryStore.setState({
            books: {
                '1': { id: '1', bookId: '1', title: 'B', author: 'Z', addedAt: 100, lastRead: 200 } as any,
                '2': { id: '2', bookId: '2', title: 'A', author: 'Y', addedAt: 300, lastRead: 100 } as any,
                '3': { id: '3', bookId: '3', title: 'C', author: 'X', addedAt: 200, lastRead: 300 } as any
            },
            viewMode: 'grid',
            sortOrder: 'recent'
        });

        // Mock reading progress for sorting
        (useReadingStateStore.getState as any).mockReturnValue({
            progress: {
                '1': { lastRead: 200 },
                '2': { lastRead: 100 },
                '3': { lastRead: 300 }
            }
        });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );
        const sortSelect = screen.getByTestId('sort-select');

        // Default: Recently Added (Newest first) -> 2 (300), 3 (200), 1 (100)
        let cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('A'); // 300
        expect(cards[1]).toHaveTextContent('C'); // 200
        expect(cards[2]).toHaveTextContent('B'); // 100

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
        expect(cards[0]).toHaveTextContent('C'); // 300
        expect(cards[1]).toHaveTextContent('B'); // 200
        expect(cards[2]).toHaveTextContent('A'); // 100
    });

    it('shows no results message when search returns nothing', async () => {
        useLibraryStore.setState({
            books: {
                '1': { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' } as any
            },
            viewMode: 'grid'
        });

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
