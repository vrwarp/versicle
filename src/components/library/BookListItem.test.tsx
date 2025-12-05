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

    it('renders book details correctly', () => {
        render(
            <MemoryRouter>
                <BookListItem book={mockBook} style={{}} />
            </MemoryRouter>
        );

        expect(screen.getByText('Test Book')).toBeInTheDocument();
        expect(screen.getByText('Test Author')).toBeInTheDocument();
        expect(screen.getByText(/50%/)).toBeInTheDocument();
        expect(screen.getByText('2.5 MB')).toBeInTheDocument();
    });

    it('handles missing file size gracefully', () => {
        const bookWithoutSize = { ...mockBook, fileSize: undefined };
        render(
            <MemoryRouter>
                <BookListItem book={bookWithoutSize} style={{}} />
            </MemoryRouter>
        );

        expect(screen.getByText('Test Book')).toBeInTheDocument();
        expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
    });

    it('shows offloaded status', () => {
        const offloadedBook = { ...mockBook, isOffloaded: true };
        render(
            <MemoryRouter>
                <BookListItem book={offloadedBook} style={{}} />
            </MemoryRouter>
        );

        expect(screen.getByText('(Offloaded)')).toBeInTheDocument();
    });
});
