import React from 'react';
import { render, screen } from '@testing-library/react';
import { BookListItem } from './BookListItem';
import { BookMetadata } from '../../types/db';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

// Mock dependencies
vi.mock('../../store/useLibraryStore', () => ({
    useLibraryStore: vi.fn(() => ({
        removeBook: vi.fn(),
        offloadBook: vi.fn(),
        restoreBook: vi.fn(),
    })),
}));

vi.mock('../../store/useToastStore', () => ({
    useToastStore: vi.fn(() => vi.fn()),
}));

vi.mock('../../store/useReaderStore', () => ({
    useReaderStore: vi.fn(() => vi.fn()),
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

    const renderItem = (book = mockBook) => {
        return render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BookListItem
                    book={book}
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
});
