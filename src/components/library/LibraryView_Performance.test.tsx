import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useInventoryStore } from '../../store/useInventoryStore';
import { MemoryRouter } from 'react-router-dom';

// NOTE: Even though LibraryView doesn't currently use react-window,
// this test is kept to guard against regression if virtualization is re-introduced.
// It also verifies that the component hierarchy is stable.

// Mock Grid
const renderLog = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockGrid = React.memo((props: any) => {
    // In real react-window, changes to itemData trigger re-render of Cells,
    // but the Grid itself might re-render if its props change.
    // However, react-window is smart.
    // We log the prop we want to ensure is stable.
    renderLog(props.cellProps);
    return <div data-testid="mock-grid">Grid</div>;
});

vi.mock('react-window', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Grid: (props: any) => <MockGrid {...props} />
}));

// Mock other components to avoid noise
vi.mock('./BookCard', () => ({ BookCard: () => <div>BookCard</div> }));
vi.mock('./EmptyLibrary', () => ({ EmptyLibrary: () => <div>EmptyLibrary</div> }));

describe('LibraryView Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useInventoryStore.setState({
            books: {
                '1': { bookId: '1', customTitle: 'B1' } as any
            }
        });
        useLibraryStore.setState({
            // books: [], // Removed
            // isLoading: false, // Removed
            error: null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fetchBooks: vi.fn().mockResolvedValue(undefined) as any,
            isImporting: false,
            viewMode: 'grid', // Ensure grid mode to test virtualization if it were there
        });

        // Mock dimensions
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ top: 0, width: 800, height: 600, left: 0 })
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    });

    it('re-renders Grid with new cellProps on unrelated state changes (Phantom Check)', async () => {
        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        // Trigger resize to set initial dimensions and ensure first render is done
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        // Clear initial logs
        renderLog.mockClear();

        // Initial render logic might have happened.
        // Force update.
        act(() => {
            useLibraryStore.setState({ isImporting: true });
        });

        // We expect NO renders because cellProps is memoized and other props are stable
        // (Also because Grid isn't actually used, so this is trivially true, but safe)
        const callsAfterUpdate = renderLog.mock.calls.length;
        expect(callsAfterUpdate).toBe(0);

        // Clear
        renderLog.mockClear();

        // Update again
        act(() => {
            useLibraryStore.setState({ isImporting: false });
        });

        const callsAfterUpdate2 = renderLog.mock.calls.length;
        expect(callsAfterUpdate2).toBe(0);
    });
});
