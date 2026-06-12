import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { LibraryView } from './LibraryView';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useLibraryStore, useBookStore } from '@store/useLibraryStore';
import { useToastStore } from '@store/useToastStore';
import { MemoryRouter } from 'react-router-dom';
import type { UserProgress, BookMetadata } from '~types/db';

// Mock zustand/middleware to disable persistence
vi.mock('zustand/middleware', () => ({
    persist: (config: unknown) => (set: unknown, get: unknown, api: unknown) => (config as (set: unknown, get: unknown, api: unknown) => unknown)(set, get, api),
    createJSONStorage: () => ({
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    }),
}));

// Mock BookCard
interface BookCardProps {
    book: BookMetadata;
}
vi.mock('./BookCard', () => ({
    BookCard: ({ book }: BookCardProps) => <div data-testid="book-card">{book.title}</div>
}));

// Mock EmptyLibrary
vi.mock('./EmptyLibrary', () => ({
    EmptyLibrary: () => <div data-testid="empty-library">Empty Library</div>
}));

// Mock ReprocessingInterstitial
interface ReprocessingInterstitialProps {
    isOpen: boolean;
}
vi.mock('./ReprocessingInterstitial', () => ({
    ReprocessingInterstitial: ({ isOpen }: ReprocessingInterstitialProps) => isOpen ? <div data-testid="reprocessing-interstitial">Processing...</div> : null
}));

vi.mock('@store/useToastStore', () => ({
    useToastStore: vi.fn(),
}));

// Phase 7: workflows moved off the store — mock the shared controller.
const { mockImportFile } = vi.hoisted(() => ({
    mockImportFile: vi.fn().mockResolvedValue({ status: 'imported', bookId: 'x' }),
}));
vi.mock('@app/library/useImportController', () => {
    const controller = {
        importFile: mockImportFile,
        replaceFile: vi.fn(),
        importFiles: vi.fn(),
        restoreBook: vi.fn(),
        removeBook: vi.fn(),
        offloadBook: vi.fn(),
        reprocessBook: vi.fn(),
        updateBook: vi.fn(),
        hydrate: vi.fn(),
    };
    return { useImportController: () => controller, libraryController: controller };
});

// Mock Select components
interface SelectItemProps {
    value: string;
    children: ReactNode;
}
vi.mock('../ui/Select', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Select: ({ value, onValueChange, children }: any) => {
        const isSortSelect = ['recent', 'last_read', 'author', 'title'].includes(value);
        return (
            <select
                data-testid={isSortSelect ? "sort-select" : "context-select"}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
            >
                {children}
            </select>
        );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SelectTrigger: ({ children }: any) => <>{children}</>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: SelectItemProps) => (
        <option value={value}>{children}</option>
    ),
}));

vi.mock('@store/useReadingStateStore', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const getProgress = (_bookId: string) => {
        // This will be overridden in tests that need custom progress
        return null;
    };
    const mockStore = Object.assign(
        vi.fn((selector) => selector ? selector({ progress: {}, getProgress }) : { progress: {}, getProgress }),
        {
            getState: vi.fn().mockReturnValue({
                progress: {},
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                getProgress: (_bookId: string) => null
            }),
            setState: vi.fn(),
            subscribe: vi.fn(),
        }
    );
    return {
        useReadingStateStore: mockStore,
        isValidProgress: (p: UserProgress | null | undefined) => !!(p && p.percentage > 0.005),
        getMostRecentProgress: (bookProgress: Record<string, UserProgress> | undefined) => {
            if (!bookProgress) return null;
            let max: UserProgress | null = null;
            for (const k in bookProgress) {
                const p = bookProgress[k];
                if (p && p.percentage > 0.005) {
                    if (!max || p.lastRead > max.lastRead) max = p;
                }
            }
            return max;
        },
    };
});
import { useReadingStateStore } from '@store/useReadingStateStore';

describe('LibraryView', () => {
    const mockShowToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock useToastStore
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useToastStore as unknown as Mock).mockImplementation((selector: any) => {
            if (selector) return selector({ showToast: mockShowToast });
            return { showToast: mockShowToast };
        });

        useBookStore.setState({
            books: {}
        });

        useLibraryStore.setState({
            isLoading: false,
            error: null,
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
        useBookStore.setState({
            books: {
                '1': { bookId: '1', title: 'B', author: 'Z', addedAt: 100, lastInteraction: 100, tags: [], status: 'unread' as const },
                '2': { bookId: '2', title: 'A', author: 'Y', addedAt: 300, lastInteraction: 300, tags: [], status: 'unread' as const },
                '3': { bookId: '3', title: 'C', author: 'X', addedAt: 200, lastInteraction: 200, tags: [], status: 'unread' as const }
            }
        });

        usePreferencesStore.setState({
            librarySortOrder: 'recent'
        });

        // Mock reading progress for sorting - using per-device structure
        // The real useAllBooks selector uses the hook to get state.progress
        const mockProgress: Record<string, Record<string, { percentage: number; lastRead: number }>> = {
            '1': { 'device-1': { percentage: 0.5, lastRead: 200 } },
            '2': { 'device-1': { percentage: 0.1, lastRead: 100 } },
            '3': { 'device-1': { percentage: 0.8, lastRead: 300 } }
        };

        // Mock the hook to return the progress map when selected
        (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
            if (selector) return selector({ progress: mockProgress });
            return { progress: mockProgress };
        });

        // Also mock getState for direct access if any (though LibraryView uses the hook via useAllBooks)
        (useReadingStateStore.getState as unknown as Mock).mockReturnValue({
            progress: mockProgress,
            getProgress: (bookId: string) => {
                // This mimics the real store's behavior roughly for tests that might call it
                const entries = Object.values(mockProgress[bookId] || {});
                return entries[0] || null;
            }
        });

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        // Default: Recently Added (Newest first) -> 2 (300), 3 (200), 1 (100)
        let cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('A'); // 300
        expect(cards[1]).toHaveTextContent('C'); // 200
        expect(cards[2]).toHaveTextContent('B'); // 100

        // Sort by Title (A-Z) -> 2 (A), 1 (B), 3 (C)
        act(() => {
            usePreferencesStore.setState({ librarySortOrder: 'title' });
        });
        cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('A');
        expect(cards[1]).toHaveTextContent('B');
        expect(cards[2]).toHaveTextContent('C');

        // Sort by Author (A-Z) -> 3 (X), 2 (Y), 1 (Z)
        act(() => {
            usePreferencesStore.setState({ librarySortOrder: 'author' });
        });
        cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('C'); // Author X
        expect(cards[1]).toHaveTextContent('A'); // Author Y
        expect(cards[2]).toHaveTextContent('B'); // Author Z

        // Sort by Last Read (Most recent first) -> 3 (300), 1 (200), 2 (100)
        act(() => {
            usePreferencesStore.setState({ librarySortOrder: 'last_read' });
        });
        cards = screen.getAllByTestId('book-card');
        expect(cards[0]).toHaveTextContent('C'); // 300
        expect(cards[1]).toHaveTextContent('B'); // 200
        expect(cards[2]).toHaveTextContent('A'); // 100
    });

    it('shows no results message when search returns nothing', async () => {
        useBookStore.setState({
            books: {
                '1': { bookId: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', addedAt: 100, lastInteraction: 100, tags: [], status: 'unread' as const }
            }
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
        mockImportFile.mockResolvedValue({ status: 'imported', bookId: 'x' });

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
            expect(mockImportFile).toHaveBeenCalledWith(file);
            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('imported successfully'), 'success', 5000);
        });
    });

    it('handles drag and drop invalid file', async () => {
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
            expect(mockImportFile).not.toHaveBeenCalled();
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
