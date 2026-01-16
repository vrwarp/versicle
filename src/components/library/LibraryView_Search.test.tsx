import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { MemoryRouter } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';

// Mock zustand persistence
vi.mock('zustand/middleware', async (importOriginal) => {
    const actual = await importOriginal<typeof import('zustand/middleware')>();
    return {
        ...actual,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
    };
});

// Mock child components
vi.mock('./BookCard', () => ({
    BookCard: ({ book }: { book: BookMetadata }) => <div data-testid={`book-card-${book.id}`}>{book.title}</div>
}));
vi.mock('./BookListItem', () => ({
    BookListItem: ({ book }: { book: BookMetadata }) => <div data-testid={`book-item-${book.id}`}>{book.title}</div>
}));
vi.mock('./EmptyLibrary', () => ({ EmptyLibrary: () => <div>EmptyLibrary</div> }));

describe('LibraryView Search', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Mock dimensions for potential virtualization
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ top: 0, width: 800, height: 600, left: 0, bottom: 600, right: 800 })
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });

        useLibraryStore.setState({
            books: {
                '1': { id: '1', bookId: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', addedAt: 100 },
                '2': { id: '2', bookId: '2', title: '1984', author: 'George Orwell', addedAt: 200 },
                '3': { id: '3', bookId: '3', title: 'Brave New World', author: 'Aldous Huxley', addedAt: 150 }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as unknown as any,
            isLoading: false,
            error: null,
            // fetchBooks removed
            isImporting: false,
            viewMode: 'grid',
            sortOrder: 'recent'
        });
    });

    it('filters books by title case-insensitively', () => {
        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        const searchInput = screen.getByTestId('library-search-input');

        // Initial state: all books visible
        expect(screen.getByTestId('book-card-1')).toBeInTheDocument();
        expect(screen.getByTestId('book-card-2')).toBeInTheDocument();
        expect(screen.getByTestId('book-card-3')).toBeInTheDocument();

        // Search for "great"
        fireEvent.change(searchInput, { target: { value: 'great' } });

        expect(screen.getByTestId('book-card-1')).toBeInTheDocument(); // The Great Gatsby
        expect(screen.queryByTestId('book-card-2')).not.toBeInTheDocument();
        expect(screen.queryByTestId('book-card-3')).not.toBeInTheDocument();
    });

    it('filters books by author case-insensitively', () => {
        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        const searchInput = screen.getByTestId('library-search-input');

        // Search for "orwell"
        fireEvent.change(searchInput, { target: { value: 'orwell' } });

        expect(screen.queryByTestId('book-card-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('book-card-2')).toBeInTheDocument(); // 1984 by George Orwell
        expect(screen.queryByTestId('book-card-3')).not.toBeInTheDocument();
    });

    it('handles empty search results', () => {
        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        const searchInput = screen.getByTestId('library-search-input');
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        expect(screen.queryByTestId('book-card-1')).not.toBeInTheDocument();
        expect(screen.queryByTestId('book-card-2')).not.toBeInTheDocument();
        expect(screen.queryByTestId('book-card-3')).not.toBeInTheDocument();
        expect(screen.getByText('No books found matching "nonexistent"')).toBeInTheDocument();
    });

    it('updates filtered list when books change', () => {
        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        const searchInput = screen.getByTestId('library-search-input');
        fireEvent.change(searchInput, { target: { value: 'new' } });

        // Initially matches "Brave New World"
        expect(screen.getByTestId('book-card-3')).toBeInTheDocument();

        // Add a new book that matches
        act(() => {
            useLibraryStore.setState((state) => ({
                books: {
                    ...state.books,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    '4': { id: '4', bookId: '4', title: 'New Moon', author: 'Stephenie Meyer', addedAt: 300 } as any
                }
            }));
        });

        // Should see both now
        expect(screen.getByTestId('book-card-3')).toBeInTheDocument();
        expect(screen.getByTestId('book-card-4')).toBeInTheDocument();
    });
});
