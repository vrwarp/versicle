import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ReassignBookDialog } from './ReassignBookDialog';
import * as selectors from '../../store/selectors';

vi.mock('../../store/selectors', () => ({
    useAllBooks: vi.fn()
}));

describe('ReassignBookDialog Empty State', () => {
    it('uses debounced search query for empty state to prevent rapid UI flashing', async () => {
        vi.useFakeTimers();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (selectors.useAllBooks as any).mockReturnValue([
            { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' },
            { id: '2', title: 'Moby Dick', author: 'Herman Melville' }
        ]);

        render(
            <ReassignBookDialog
                isOpen={true}
                onClose={() => {}}
                onConfirm={() => {}}
            />
        );

        const searchInput = screen.getByRole('searchbox', { name: 'Search books' });

        // Simulate a rapid keypress from 'M' to 'Mxyzptlk'
        act(() => {
            fireEvent.change(searchInput, { target: { value: 'Mxyzptlk' } });
        });

        // Immediately after typing, the UI should still show the old empty state (nothing because query is debouncing)
        // rather than flashing "No books found matching Mxyzptlk"
        expect(screen.queryByText(/No books found matching/)).not.toBeInTheDocument();

        // Advance timers by debounce delay (300ms)
        act(() => {
            vi.advanceTimersByTime(300);
        });

        // Now the empty state should be visible
        expect(screen.getByText('No books found matching "Mxyzptlk"')).toBeInTheDocument();

        vi.useRealTimers();
    });
});
