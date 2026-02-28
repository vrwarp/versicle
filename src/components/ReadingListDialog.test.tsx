import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ReadingListDialog } from './ReadingListDialog';

// Mock Radix UI Modal
vi.mock('./ui/Modal', () => {
    return {
        Modal: ({ open, children }: { open: boolean, children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
        ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        ModalTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        ModalDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    };
});

// Mock dependencies
vi.mock('./EditReadingListEntryDialog', () => ({
    EditReadingListEntryDialog: () => <div data-testid="edit-dialog" />
}));

// Mock Checkbox to ensure it renders accessible elements for testing
vi.mock('./ui/Checkbox', () => ({
    Checkbox: ({ checked, onCheckedChange, 'aria-label': ariaLabel }: { checked: boolean, onCheckedChange: (c: boolean) => void, 'aria-label': string }) => (
        <button
            role="checkbox"
            aria-checked={checked}
            aria-label={ariaLabel}
            onClick={() => onCheckedChange(!checked)}
        />
    )
}));

// Mock store with data
const mockEntries = {
    'book1.epub': {
        filename: 'book1.epub',
        title: 'Book A',
        author: 'Author Z',
        status: 'read',
        percentage: 1.0,
        rating: 5,
        lastUpdated: 1000
    },
    'book2.epub': {
        filename: 'book2.epub',
        title: 'Book B',
        author: 'Author Y',
        status: 'to-read',
        percentage: 0.0,
        rating: 3,
        lastUpdated: 2000
    },
    'book3.epub': {
        filename: 'book3.epub',
        title: 'Book C',
        author: 'Author X',
        status: 'currently-reading',
        percentage: 0.5,
        rating: 4,
        lastUpdated: 3000
    }
};

const { mockRemoveEntry } = vi.hoisted(() => ({
    mockRemoveEntry: vi.fn(),
}));

vi.mock('../store/useReadingListStore', () => ({
    useReadingListStore: Object.assign(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (selector: any) => selector ? selector({ entries: mockEntries }) : { entries: mockEntries },
        {
            getState: () => ({
                entries: mockEntries,
                removeEntry: mockRemoveEntry,
                upsertEntry: vi.fn()
            })
        }
    )
}));

describe('ReadingListDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders correctly', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);
        expect(screen.getByText('Reading List')).toBeInTheDocument();
        expect(screen.getByText('Book A')).toBeInTheDocument();
        expect(screen.getByText('Book B')).toBeInTheDocument();
        expect(screen.getByText('Book C')).toBeInTheDocument();
    });

    it('sorts entries by title', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);

        // Find header for Title
        const titleButton = screen.getByRole('button', { name: /Title/i });
        expect(titleButton).toBeInTheDocument();

        // Should default to lastUpdated desc, so Book C should be first
        const rows = screen.getAllByRole('row');
        // row 0 is header, row 1 is first data row
        expect(rows[1]).toHaveTextContent('Book C');

        // Click title to sort (defaults to desc)
        fireEvent.click(titleButton);

        const rowsAfterSort = screen.getAllByRole('row');
        expect(rowsAfterSort[1]).toHaveTextContent('Book C'); // Book C is last alphabetically, so first in desc

        // Click title again to sort asc
        fireEvent.click(titleButton);
        const rowsAfterSortAsc = screen.getAllByRole('row');
        expect(rowsAfterSortAsc[1]).toHaveTextContent('Book A');
    });

    it('selects and deselects entries', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);

        // Select Book A
        const checkboxA = screen.getByRole('checkbox', { name: /Select Book A/i });
        fireEvent.click(checkboxA);
        expect(checkboxA).toBeChecked();

        // Select Book B
        const checkboxB = screen.getByRole('checkbox', { name: /Select Book B/i });
        fireEvent.click(checkboxB);
        expect(checkboxB).toBeChecked();

        // Verify batch actions appear
        expect(screen.getByText(/Delete \(2\)/)).toBeInTheDocument();
        expect(screen.getByText('Export CSV')).toBeInTheDocument();

        // Deselect Book A
        fireEvent.click(checkboxA);
        expect(checkboxA).not.toBeChecked();
        expect(checkboxB).toBeChecked();
        expect(screen.getByText(/Delete \(1\)/)).toBeInTheDocument();
    });

    it('selects all entries via header checkbox', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);

        // Get select all checkbox
        const selectAll = screen.getByRole('checkbox', { name: /Select all/i });
        fireEvent.click(selectAll);

        // All checkboxes should be checked
        expect(selectAll).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Select Book A/i })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Select Book B/i })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Select Book C/i })).toBeChecked();

        // Deselect all
        fireEvent.click(selectAll);
        expect(selectAll).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Select Book A/i })).not.toBeChecked();
    });

    it('has accessible table headers', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);

        const headers = ['Title', 'Author', 'Status', 'Progress', 'Rating', 'Last Read'];

        headers.forEach(header => {
            const button = screen.getByRole('button', { name: new RegExp(header, 'i') });
            expect(button).toBeInTheDocument();
            // Verify it's inside a TH with aria-sort (initially undefined unless sorted)
            const th = button.closest('th');
            expect(th).toBeInTheDocument();
        });
    });

    it('shows confirmation dialog when deleting an entry', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);

        // Find delete button for "Book A"
        const row = screen.getByRole('row', { name: /Book A/i });
        const deleteButton = within(row).getByRole('button', { name: /delete/i });

        fireEvent.click(deleteButton);

        // Check if confirmation dialog appears
        expect(screen.getByText('Delete Entry')).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to delete "Book A"/i)).toBeInTheDocument();

        // Click confirm
        const confirmationDialog = screen.getByText(/Are you sure you want to delete "Book A"/i).closest('div[role="dialog"]');
        expect(confirmationDialog).toBeInTheDocument();

        const confirmButton = within(confirmationDialog as HTMLElement).getByRole('button', { name: 'Delete' });
        fireEvent.click(confirmButton);

        expect(mockRemoveEntry).toHaveBeenCalledWith('book1.epub');
    });
});
