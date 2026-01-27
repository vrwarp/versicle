import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { ReprocessingInterstitial } from './ReprocessingInterstitial';
import { reprocessBook } from '../../lib/ingestion';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mocks
vi.mock('../../lib/ingestion', () => ({
    reprocessBook: vi.fn(),
}));

vi.mock('../../store/useLibraryStore', () => ({
    useLibraryStore: {
        getState: vi.fn(() => ({
            hydrateStaticMetadata: vi.fn().mockResolvedValue(undefined),
        })),
    },
}));

describe('ReprocessingInterstitial', () => {
    const mockOnComplete = vi.fn();
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('calls reprocessBook and hydrates metadata on mount when open', async () => {
        const bookId = 'test-book-123';
        (reprocessBook as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        const mockHydrate = vi.fn().mockResolvedValue(undefined);
        (useLibraryStore.getState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            hydrateStaticMetadata: mockHydrate,
        });

        render(
            <ReprocessingInterstitial
                isOpen={true}
                bookId={bookId}
                onComplete={mockOnComplete}
                onClose={mockOnClose}
            />
        );

        expect(reprocessBook).toHaveBeenCalledWith(bookId);

        await waitFor(() => {
            expect(mockHydrate).toHaveBeenCalled();
        });

        expect(mockOnComplete).toHaveBeenCalled();
    });

    it('shows error message if reprocessing fails', async () => {
        const bookId = 'test-book-123';
        (reprocessBook as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Reprocessing failed'));

        const { getByText } = render(
            <ReprocessingInterstitial
                isOpen={true}
                bookId={bookId}
                onComplete={mockOnComplete}
                onClose={mockOnClose}
            />
        );

        await waitFor(() => {
            expect(getByText(/Failed to upgrade book: Reprocessing failed/)).toBeInTheDocument();
        });

        const mockHydrate = useLibraryStore.getState().hydrateStaticMetadata;
        expect(mockHydrate).not.toHaveBeenCalled();
        expect(mockOnComplete).not.toHaveBeenCalled();
    });
});
