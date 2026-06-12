import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ReprocessingInterstitial } from './ReprocessingInterstitial';
import { libraryController } from '@app/library/useImportController';

// Phase 7: reprocess routes through the orchestrator queue via the shared
// controller (the job refreshes the projection itself — no manual hydrate).
vi.mock('@app/library/useImportController', () => {
    const controller = { reprocessBook: vi.fn() };
    return { libraryController: controller, useImportController: () => controller };
});
const reprocessBook = libraryController.reprocessBook;

describe('ReprocessingInterstitial', () => {
    const mockOnComplete = vi.fn();
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes reprocessing through the controller on mount when open', async () => {
        const bookId = 'test-book-123';
        (reprocessBook as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

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
            expect(mockOnComplete).toHaveBeenCalled();
        });
    });

    it('shows error message if reprocessing fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
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

        expect(mockOnComplete).not.toHaveBeenCalled();
    });
});
