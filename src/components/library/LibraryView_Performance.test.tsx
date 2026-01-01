import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';

// Mock List (FixedSizeList)
const renderLog = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockList = React.memo((props: any) => {
    // If props change, this renders.
    // If props are equal, it might NOT render (if parent doesn't force it? But parent re-renders).
    // React.memo only prevents render if props are shallowly equal.
    renderLog(props.itemCount);
    // Render at least one row to test children
    return <div data-testid="mock-list">
        {props.children({ index: 0, style: {} })}
    </div>;
});

vi.mock('react-window', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FixedSizeList: (props: any) => <MockList {...props} />
}));

// Mock useWindowSize
vi.mock('../../hooks/useWindowSize', () => ({
    useWindowSize: () => ({ width: 1000, height: 800 })
}));

// Mock other components to avoid noise
vi.mock('./BookCard', () => ({ BookCard: () => <div>BookCard</div> }));
vi.mock('./EmptyLibrary', () => ({ EmptyLibrary: () => <div>EmptyLibrary</div> }));

describe('LibraryView Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useLibraryStore.setState({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            books: [{ id: '1', title: 'B1' } as any],
            isLoading: false,
            error: null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fetchBooks: vi.fn().mockResolvedValue(undefined) as any,
            isImporting: false
        });

        // Mock dimensions
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ top: 0 })
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    });

    it('renders List and handles updates correctly', async () => {
        render(<LibraryView />);

        // Check if List is rendered
        expect(renderLog).toHaveBeenCalled();
        renderLog.mockClear();

        // Force update unrelated state
        act(() => {
            useLibraryStore.setState({ isImporting: true });
        });

        // Now that GridRow is memoized with useCallback, the children prop of List should be stable
        // (assuming other props of List like itemCount are also stable).
        // So MockList (React.memo) should NOT re-render.
        expect(renderLog.mock.calls.length).toBe(0);
    });
});
