import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { GlobalNotesView } from '../GlobalNotesView';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useAnnotationStore } from '../../../store/useAnnotationStore';
import { MemoryRouter, useNavigate } from 'react-router-dom';

// Mock navigate
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual as unknown,
        useNavigate: vi.fn(),
    };
});

// Mock Zustand stores
vi.mock('../../../store/useLibraryStore', () => ({
    useLibraryStore: {
        getState: vi.fn(),
    }
}));

vi.mock('../../../store/useAnnotationStore', () => ({
    useAnnotationStore: Object.assign(vi.fn(), {
        getState: vi.fn(),
    })
}));

// Mock selectors
vi.mock('../../../store/selectors', () => ({
    selectPendingAudioBookmarks: (state: { annotations?: Record<string, { type: string, pending?: boolean }> }) => {
        return Object.values(state.annotations || {}).filter(
            (a: { type: string, pending?: boolean }) => a.type === 'audio_bookmark' && a.pending
        );
    }
}));

// Mock hooks
vi.mock('../../../hooks/useGroupedAnnotations', () => ({
    useGroupedAnnotations: vi.fn(),
}));

vi.mock('../../../hooks/useDebounce', () => ({
    useDebounce: (val: string) => val,
}));

import { useGroupedAnnotations } from '../../../hooks/useGroupedAnnotations';

// Mock sub-components
vi.mock('../NotesSearchBar', () => ({
    NotesSearchBar: ({ value, onChange }: { value: string, onChange: (v: string) => void }) => (
        <input
            data-testid="notes-search-bar"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    )
}));

vi.mock('../BookNotesBlock', () => ({
    BookNotesBlock: ({ group, onNavigate, onOpenBook }: { group: { bookId: string }, onNavigate: (id: string, cfi: string) => void, onOpenBook: (id: string) => void }) => (
        <div data-testid="book-notes-block" data-book={group.bookId}>
            <button data-testid={`nav-${group.bookId}`} onClick={() => onNavigate(group.bookId, 'epubcfi(/1)')}>Nav</button>
            <button data-testid={`open-${group.bookId}`} onClick={() => onOpenBook(group.bookId)}>Open</button>
        </div>
    )
}));

describe('GlobalNotesView', () => {
    let mockNavigate: Mock;
    let mockOnContentMissing: Mock;
    let mockRemove: Mock;
    let mockAdd: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        mockNavigate = vi.fn();
        (useNavigate as Mock).mockReturnValue(mockNavigate);
        mockOnContentMissing = vi.fn();
        mockRemove = vi.fn();
        mockAdd = vi.fn();

        (useLibraryStore.getState as Mock).mockReturnValue({
            staticMetadata: {},
            offloadedBookIds: new Set()
        });

        (useAnnotationStore as unknown as Mock).mockImplementation((selector) => {
            return selector({ annotations: {} });
        });

        (useAnnotationStore.getState as Mock).mockReturnValue({
            remove: mockRemove,
            add: mockAdd
        });

        (useGroupedAnnotations as Mock).mockReturnValue([]);
    });

    const renderComponent = () => {
        return render(
            <MemoryRouter>
                <GlobalNotesView onContentMissing={mockOnContentMissing} />
            </MemoryRouter>
        );
    };

    it('renders empty state when there are no annotations', () => {
        renderComponent();
        expect(screen.getByText('No annotations yet')).toBeDefined();
        expect(screen.getByText(/Read a book and highlight text/)).toBeDefined();
    });

    it('renders no results found when search has no matches', () => {
        renderComponent();

        const searchInput = screen.getByTestId('notes-search-bar');
        act(() => {
            fireEvent.change(searchInput, { target: { value: 'query' } });
        });

        expect(screen.getByText('No results found')).toBeDefined();
        expect(screen.getByText(/No annotations or notes matching/)).toBeDefined();
    });

    it('clears search when Clear search button is clicked', () => {
        renderComponent();

        const searchInput = screen.getByTestId('notes-search-bar') as HTMLInputElement;
        act(() => {
            fireEvent.change(searchInput, { target: { value: 'query' } });
        });

        const clearBtn = screen.getByRole('button', { name: 'Clear search query' });
        act(() => {
            fireEvent.click(clearBtn);
        });

        expect(searchInput.value).toBe('');
    });

    it('renders grouped annotations', () => {
        (useGroupedAnnotations as Mock).mockReturnValue([
            { bookId: 'book-1', annotations: [] },
            { bookId: 'book-2', annotations: [] }
        ]);

        renderComponent();

        const blocks = screen.getAllByTestId('book-notes-block');
        expect(blocks).toHaveLength(2);
        expect(blocks[0].getAttribute('data-book')).toBe('book-1');
        expect(blocks[1].getAttribute('data-book')).toBe('book-2');
    });

    it('renders pending audio bookmarks and allows interaction', () => {
        const mockBookmarks = {
            'bookmark-1': { id: 'bookmark-1', bookId: 'book-1', type: 'audio_bookmark', pending: true, text: 'Test bookmark' }
        };

        (useAnnotationStore as unknown as Mock).mockImplementation((selector) => {
            return selector({ annotations: mockBookmarks });
        });

        (useLibraryStore.getState as Mock).mockReturnValue({
            staticMetadata: {
                'book-1': { title: 'Book One' }
            },
            offloadedBookIds: new Set()
        });

        renderComponent();

        expect(screen.getByText(/Audio Bookmarks Inbox \(1\)/)).toBeDefined();
        expect(screen.getByText(/"Test bookmark"/)).toBeDefined();
        expect(screen.getByText('Book One')).toBeDefined();

        // Discard
        const discardBtn = screen.getByText('Discard');
        act(() => {
            fireEvent.click(discardBtn);
        });
        expect(mockRemove).toHaveBeenCalledWith('bookmark-1');

        // Keep
        const keepBtn = screen.getByText('Keep');
        act(() => {
            fireEvent.click(keepBtn);
        });
        expect(mockRemove).toHaveBeenCalledWith('bookmark-1');
        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
            id: 'bookmark-1',
            type: 'highlight',
        }));
    });

    describe('Navigation', () => {
        beforeEach(() => {
            (useGroupedAnnotations as Mock).mockReturnValue([
                { bookId: 'book-1', annotations: [] }
            ]);
        });

        it('navigates to read view for known books', () => {
            (useLibraryStore.getState as Mock).mockReturnValue({
                staticMetadata: { 'book-1': { title: 'Book One' } },
                offloadedBookIds: new Set()
            });

            renderComponent();

            // Test onNavigate
            act(() => {
                fireEvent.click(screen.getByTestId('nav-book-1'));
            });
            expect(mockNavigate).toHaveBeenCalledWith('/read/book-1?cfi=epubcfi(%2F1)');

            // Test onOpenBook
            act(() => {
                fireEvent.click(screen.getByTestId('open-book-1'));
            });
            expect(mockNavigate).toHaveBeenCalledWith('/read/book-1');
        });

        it('calls onContentMissing for ghost books (no metadata, no file)', () => {
            (useLibraryStore.getState as Mock).mockReturnValue({
                staticMetadata: {}, // No metadata
                offloadedBookIds: new Set() // Not offloaded either = ghost
            });

            renderComponent();

            act(() => {
                fireEvent.click(screen.getByTestId('open-book-1'));
            });

            expect(mockOnContentMissing).toHaveBeenCalledWith('book-1');
            expect(mockNavigate).not.toHaveBeenCalled();
        });

        it('calls onContentMissing for offloaded books', () => {
            (useLibraryStore.getState as Mock).mockReturnValue({
                staticMetadata: { 'book-1': { title: 'Book One' } },
                offloadedBookIds: new Set(['book-1'])
            });

            renderComponent();

            act(() => {
                fireEvent.click(screen.getByTestId('nav-book-1'));
            });

            expect(mockOnContentMissing).toHaveBeenCalledWith('book-1');
            expect(mockNavigate).not.toHaveBeenCalled();
        });
    });
});
