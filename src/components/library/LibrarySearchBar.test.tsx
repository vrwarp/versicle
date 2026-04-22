import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { LibrarySearchBar } from './LibrarySearchBar';
import React from 'react';

describe('LibrarySearchBar', () => {
    it('renders input correctly', () => {
        const onQueryChange = vi.fn();
        render(<LibrarySearchBar onQueryChange={onQueryChange} filteredCount={0} isFilteredEmpty={false} />);

        expect(screen.getByTestId('library-search-input')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search library...')).toBeInTheDocument();
    });

    it('debounces input changes', () => {
        vi.useFakeTimers();
        const onQueryChange = vi.fn();

        render(<LibrarySearchBar onQueryChange={onQueryChange} filteredCount={0} isFilteredEmpty={false} />);

        const input = screen.getByTestId('library-search-input');

        act(() => {
            fireEvent.change(input, { target: { value: 'test' } });
        });

        // Initial call with empty string from mount
        expect(onQueryChange).toHaveBeenCalledWith('');

        // Fast forward less than debounce time
        act(() => {
            vi.advanceTimersByTime(150);
        });

        // Should not have been called with new value yet
        expect(onQueryChange).not.toHaveBeenCalledWith('test');

        // Fast forward past debounce time
        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(onQueryChange).toHaveBeenCalledWith('test');

        vi.useRealTimers();
    });

    it('clears search when clear button is clicked', () => {
        const onQueryChange = vi.fn();

        render(<LibrarySearchBar onQueryChange={onQueryChange} filteredCount={0} isFilteredEmpty={false} />);

        const input = screen.getByTestId('library-search-input');

        act(() => {
            fireEvent.change(input, { target: { value: 'test' } });
        });

        const clearButton = screen.getByRole('button', { name: 'Clear search' });
        expect(clearButton).toBeInTheDocument();

        act(() => {
            fireEvent.click(clearButton);
        });

        expect(input).toHaveValue('');
    });

    it('exposes clearSearch via ref', () => {
        const onQueryChange = vi.fn();
        const ref = React.createRef<any>();

        render(<LibrarySearchBar ref={ref} onQueryChange={onQueryChange} filteredCount={0} isFilteredEmpty={false} />);

        const input = screen.getByTestId('library-search-input');

        act(() => {
            fireEvent.change(input, { target: { value: 'test' } });
        });

        expect(input).toHaveValue('test');

        act(() => {
            ref.current?.clearSearch();
        });

        expect(input).toHaveValue('');
    });

    it('displays screen reader text correctly when empty', () => {
        vi.useFakeTimers();
        const onQueryChange = vi.fn();

        render(<LibrarySearchBar onQueryChange={onQueryChange} filteredCount={0} isFilteredEmpty={true} />);

        const input = screen.getByTestId('library-search-input');

        act(() => {
            fireEvent.change(input, { target: { value: 'test' } });
        });

        act(() => {
            vi.advanceTimersByTime(350);
        });

        expect(screen.getByText('No books found')).toBeInTheDocument();
        vi.useRealTimers();
    });

    it('displays screen reader text correctly with results', () => {
        vi.useFakeTimers();
        const onQueryChange = vi.fn();

        const { rerender } = render(<LibrarySearchBar onQueryChange={onQueryChange} filteredCount={0} isFilteredEmpty={true} />);

        const input = screen.getByTestId('library-search-input');

        act(() => {
            fireEvent.change(input, { target: { value: 'test' } });
        });

        act(() => {
            vi.advanceTimersByTime(350);
        });

        rerender(<LibrarySearchBar onQueryChange={onQueryChange} filteredCount={5} isFilteredEmpty={false} />);

        expect(screen.getByText('5 books found')).toBeInTheDocument();
        vi.useRealTimers();
    });
});
