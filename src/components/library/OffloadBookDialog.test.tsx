import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { OffloadBookDialog } from './OffloadBookDialog';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { BookMetadata } from '../../types/db';

// Mock logger
vi.mock('../../lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }))
}));

// Mock UI components
vi.mock('../ui/Dialog', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Dialog: ({ isOpen, title, description, footer }: any) => {
        if (!isOpen) return null;
        return (
            <div data-testid="dialog">
                <h1>{title}</h1>
                <p>{description}</p>
                {footer}
            </div>
        );
    }
}));

vi.mock('../ui/Button', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Button: ({ onClick, disabled, children, ...props }: any) => (
        <button onClick={onClick} disabled={disabled} {...props}>
            {children}
        </button>
    )
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    Loader2: () => <div data-testid="spinner">Spinner</div>
}));

// Mock useToastStore
vi.mock('../../store/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

describe('OffloadBookDialog', () => {
    const mockOffloadBook = vi.fn();
    const mockShowToast = vi.fn();
    const mockOnClose = vi.fn();

    const mockBook: BookMetadata = {
        id: 'book-1',
        title: 'Test Book',
        author: 'Test Author',
        isOffloaded: false,
    } as unknown as BookMetadata;

    beforeEach(() => {
        vi.clearAllMocks();

        useLibraryStore.setState({
            offloadBook: mockOffloadBook
        });

        // Mock useToastStore implementation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useToastStore as any).mockImplementation((selector: any) => {
            if (selector) return selector({ showToast: mockShowToast });
            return { showToast: mockShowToast };
        });
    });

    it('renders correctly when open', () => {
        render(
            <OffloadBookDialog
                isOpen={true}
                onClose={mockOnClose}
                book={mockBook}
            />
        );

        expect(screen.getByTestId('dialog')).toBeInTheDocument();
        expect(screen.getByText(`Offload "${mockBook.title}"? This will delete the local file to save space but keep your reading progress and annotations.`)).toBeInTheDocument();
        expect(screen.getByTestId('confirm-offload')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('does not render when book is null', () => {
        render(
            <OffloadBookDialog
                isOpen={true}
                onClose={mockOnClose}
                book={null}
            />
        );

        expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    it('handles offload success flow', async () => {
        // Delay the mock to allow checking loading state
        mockOffloadBook.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

        render(
            <OffloadBookDialog
                isOpen={true}
                onClose={mockOnClose}
                book={mockBook}
            />
        );

        const confirmButton = screen.getByTestId('confirm-offload');

        // Initial state
        expect(confirmButton).not.toBeDisabled();
        expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();

        // Click offload
        fireEvent.click(confirmButton);

        // Check loading state
        expect(confirmButton).toBeDisabled();
        expect(screen.getByTestId('spinner')).toBeInTheDocument();

        // Wait for completion
        await waitFor(() => {
            expect(mockOffloadBook).toHaveBeenCalledWith(mockBook.id);
            expect(mockShowToast).toHaveBeenCalledWith(`Offloaded "${mockBook.title}"`, 'success');
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    it('handles offload error flow', async () => {
        const error = new Error('Offload failed');
        mockOffloadBook.mockRejectedValue(error);

        render(
            <OffloadBookDialog
                isOpen={true}
                onClose={mockOnClose}
                book={mockBook}
            />
        );

        fireEvent.click(screen.getByTestId('confirm-offload'));

        await waitFor(() => {
            expect(mockOffloadBook).toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith("Failed to offload book", "error");
            // Dialog should remain open on error
            expect(mockOnClose).not.toHaveBeenCalled();
            // Loading state should be cleared
            expect(screen.getByTestId('confirm-offload')).not.toBeDisabled();
            expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
        });
    });
});
