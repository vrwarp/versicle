import { render, screen, fireEvent } from '@testing-library/react';
import { BookListItem } from './BookListItem';
import type { BookMetadata } from '~types/book';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@store/useLibraryStore', () => ({
    useLibraryStore: vi.fn(() => ({
        removeBook: vi.fn(),
        offloadBook: vi.fn(),
        restoreBook: vi.fn(),
    })),
}));

vi.mock('@store/useReadingStateStore', () => ({
    useReadingStateStore: vi.fn(() => vi.fn()),
    useBookProgress: vi.fn(() => ({ percentage: 0.5, lastRead: Date.now() })),
}));

describe('BookListItem', () => {
    const mockBook: BookMetadata = {
        id: '1',
        title: 'Test Book',
        author: 'Test Author',
        addedAt: Date.now(),
        progress: 0.5,
        fileSize: 1024 * 1024 * 2.5, // 2.5 MB
        isOffloaded: false,
    };

    const mockOnDelete = vi.fn();
    const mockOnOffload = vi.fn();
    const mockOnRestore = vi.fn();
    const mockOnOpen = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderItem = (book = mockBook, isGhostBook = false) => {
        return render(
            <MemoryRouter>
                <BookListItem
                    book={book}
                    isGhostBook={isGhostBook}
                    onOpen={mockOnOpen}
                    onDelete={mockOnDelete}
                    onOffload={mockOnOffload}
                    onRestore={mockOnRestore}
                />
            </MemoryRouter>
        );
    };

    it('renders book details correctly', () => {
        renderItem();

        expect(screen.getByText('Test Book')).toBeInTheDocument();
        expect(screen.getByText('Test Author')).toBeInTheDocument();
        expect(screen.getByText(/50%/)).toBeInTheDocument();
        expect(screen.getByText('2.5 MB')).toBeInTheDocument();
    });

    it('handles missing file size gracefully', () => {
        const bookWithoutSize = { ...mockBook, fileSize: undefined };
        renderItem(bookWithoutSize);

        expect(screen.getByText('Test Book')).toBeInTheDocument();
        expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
    });

    it('shows offloaded status', () => {
        const offloadedBook = { ...mockBook, isOffloaded: true };
        renderItem(offloadedBook);

        expect(screen.getByText('(Offloaded)')).toBeInTheDocument();
    });

    it('renders palette background when no cover image is present', () => {
        const paletteBook = {
            ...mockBook,
            coverPalette: [123, 456, 789, 101, 112]
        };
        const { container } = renderItem(paletteBook);

        const thumbnail = container.querySelector('[style*="background-image"]');
        expect(thumbnail).toBeInTheDocument();
        expect(thumbnail?.getAttribute('style')).toContain('radial-gradient');
    });

    describe('regression: clicking an offloaded or ghost BookListItem triggers onRestore', () => {
        it('calls onRestore instead of dead-ending when offloaded', () => {
            const offloadedBook = { ...mockBook, isOffloaded: true };
            renderItem(offloadedBook);

            fireEvent.click(screen.getByText('Test Book'));
            expect(mockOnRestore).toHaveBeenCalledWith(offloadedBook);
            expect(mockOnOpen).not.toHaveBeenCalled();
        });

        it('calls onRestore when ghost book is clicked', () => {
            renderItem(mockBook, true);

            fireEvent.click(screen.getByText('Test Book'));
            expect(mockOnRestore).toHaveBeenCalledWith(mockBook);
            expect(mockOnOpen).not.toHaveBeenCalled();
        });
    });
});
