import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Mock store with NO data
vi.mock('../store/useReadingListStore', () => ({
    useReadingListStore: Object.assign(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (selector: any) => selector ? selector({ entries: {} }) : { entries: {} },
        {
            getState: () => ({
                entries: {},
                removeEntry: vi.fn(),
                upsertEntry: vi.fn()
            })
        }
    )
}));

describe('ReadingListDialog Empty State', () => {
    it('renders empty state correctly', () => {
        render(<ReadingListDialog open={true} onOpenChange={vi.fn()} />);

        expect(screen.getByText('Your reading list is empty')).toBeInTheDocument();
        expect(screen.getByText(/Books are automatically added here/i)).toBeInTheDocument();
        // Check if table is NOT present
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
});
