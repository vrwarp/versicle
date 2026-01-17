import React from 'react';
import { render, screen } from '@testing-library/react';
import { BookCover } from './BookCover';
import type { BookMetadata } from '../../types/db';
import { vi } from 'vitest';

describe('BookCover', () => {
    const mockBook: BookMetadata = {
        id: '1',
        title: 'Test Title',
        author: 'Test Author',
        addedAt: Date.now(),
        coverPalette: [0, 0, 0, 0, 0], // Valid palette to trigger gradient
    };

    const mockHandlers = {
        onDelete: vi.fn(),
        onOffload: vi.fn(),
        onRestore: vi.fn(),
    };

    it('should render title and author on placeholder when cover is missing', () => {
        render(<BookCover book={mockBook} {...mockHandlers} />);

        // Verify title and author are present
        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Author')).toBeInTheDocument();

        // Verify gradient style is applied (indirectly, by checking for text presence which only happens in gradient block)
        // Also checking for absence of "Aa" placeholder
        expect(screen.queryByText('Aa')).not.toBeInTheDocument();
    });

    it('should render "Aa" placeholder when palette is missing', () => {
        const bookWithoutPalette = { ...mockBook, coverPalette: undefined };
        render(<BookCover book={bookWithoutPalette} {...mockHandlers} />);

        expect(screen.getByText('Aa')).toBeInTheDocument();
        // Title and author are NOT rendered in the generic placeholder block
        expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
        expect(screen.queryByText('Test Author')).not.toBeInTheDocument();
    });

    it('should render cloud icon when offloaded', () => {
        const offloadedBook = { ...mockBook, isOffloaded: true };
        render(<BookCover book={offloadedBook} {...mockHandlers} />);

        // Check for offloaded overlay
        expect(screen.getByTestId('offloaded-overlay')).toBeInTheDocument();
        // And title/author should still be there behind/underneath
        expect(screen.getByText('Test Title')).toBeInTheDocument();
    });
});
