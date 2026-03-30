import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SmartLinkDialog } from './SmartLinkDialog';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { useReadingListStore } from '../store/useReadingListStore';
import { useBookStore } from '../store/useBookStore';
import { useGenAIStore } from '../store/useGenAIStore';
import { genAIService } from '../lib/genai/GenAIService';

// Mock dependencies
vi.mock('../store/useReadingListStore');
vi.mock('../store/useBookStore');
vi.mock('../store/useGenAIStore');
vi.mock('../lib/genai/GenAIService');

describe('SmartLinkDialog', () => {
    let mockAddEntry: Mock;
    let mockRemoveEntry: Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        mockAddEntry = vi.fn();
        mockRemoveEntry = vi.fn();

        (useReadingListStore.getState as Mock).mockReturnValue({
            addEntry: mockAddEntry,
            removeEntry: mockRemoveEntry,
            entries: {
                'unmapped_entry_1': { filename: 'unmapped_entry_1', title: 'Test Book', author: 'Author A', percentage: 0.5 },
                'mapped_entry_2': { filename: 'mapped_entry_2', title: 'Mapped Book', author: 'Author B', percentage: 1 }
            }
        });

        (useReadingListStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) =>
            selector({
                entries: {
                    'unmapped_entry_1': { filename: 'unmapped_entry_1', title: 'Test Book', author: 'Author A', percentage: 0.5 },
                    'mapped_entry_2': { filename: 'mapped_entry_2', title: 'Mapped Book', author: 'Author B', percentage: 1 }
                }
            })
        );

        (useBookStore.getState as Mock).mockReturnValue({
            books: {
                'unmapped_book_1': { bookId: 'unmapped_book_1', title: 'Test Book', author: 'Author A', sourceFilename: 'some_other_filename.epub' },
                'mapped_book_2': { bookId: 'mapped_book_2', title: 'Mapped Book', author: 'Author B', sourceFilename: 'mapped_entry_2' }
            }
        });

        (useBookStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) =>
            selector({
                books: {
                    'unmapped_book_1': { bookId: 'unmapped_book_1', title: 'Test Book', author: 'Author A', sourceFilename: 'some_other_filename.epub' },
                    'mapped_book_2': { bookId: 'mapped_book_2', title: 'Mapped Book', author: 'Author B', sourceFilename: 'mapped_entry_2' }
                }
            })
        );

        (useGenAIStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) =>
            selector({ isEnabled: true })
        );

        (genAIService.mapReadingListToLibrary as Mock).mockResolvedValue([
            { readingListFilename: 'unmapped_entry_1', libraryBookId: 'unmapped_book_1' }
        ]);
    });

    it('renders correctly when there are unmapped entries and books', async () => {
        render(<SmartLinkDialog open={true} onOpenChange={vi.fn()} />);

        expect(screen.getByText('Smart Link Books')).toBeInTheDocument();

        await waitFor(() => {
            expect(genAIService.mapReadingListToLibrary).toHaveBeenCalledTimes(1);
        });

        // The mapped books should appear in the dialog
        expect(await screen.findAllByText('Test Book')).toHaveLength(2); // One for reading list side, one for library side
        expect(await screen.findAllByText('Author A')).toHaveLength(2);
    });

    it('displays error message if GenAI service fails', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        (genAIService.mapReadingListToLibrary as Mock).mockRejectedValue(new Error('AI Error'));

        render(<SmartLinkDialog open={true} onOpenChange={vi.fn()} />);

        expect(await screen.findByText('AI Error')).toBeInTheDocument();

        consoleSpy.mockRestore();
    });

    it('shows no mappings message when no unmapped entries exist', async () => {
        (useReadingListStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) =>
            selector({
                entries: {
                    'mapped_entry_2': { filename: 'mapped_entry_2', title: 'Mapped Book', author: 'Author B', percentage: 1 }
                }
            })
        );

        render(<SmartLinkDialog open={true} onOpenChange={vi.fn()} />);

        expect(await screen.findByText('No suggested mappings found.')).toBeInTheDocument();
    });

    it('applies selected mappings and updates stores', async () => {
        // Need to reset the resolved value because it was changed in a previous test
        (genAIService.mapReadingListToLibrary as Mock).mockResolvedValue([
            { readingListFilename: 'unmapped_entry_1', libraryBookId: 'unmapped_book_1' }
        ]);

        render(<SmartLinkDialog open={true} onOpenChange={vi.fn()} />);

        // Wait for mappings to load
        await waitFor(() => {
            expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
        });

        // Uncheck and re-check to test toggle (it's checked by default in the implementation)
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();

        const applyButton = screen.getByRole('button', { name: /Apply Selected/ });
        expect(applyButton).toBeEnabled();

        fireEvent.click(applyButton);

        expect(mockAddEntry).toHaveBeenCalledWith(expect.objectContaining({
            filename: 'some_other_filename.epub',
            title: 'Test Book',
            author: 'Author A'
        }));
        expect(mockRemoveEntry).toHaveBeenCalledWith('unmapped_entry_1');
    });
});
