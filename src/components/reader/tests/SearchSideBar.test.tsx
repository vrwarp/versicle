import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchSideBar } from '../SearchSideBar';
import { searchClient } from '../../../lib/search';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../../lib/search', () => ({
    searchClient: {
        search: vi.fn()
    }
}));

describe('SearchSideBar', () => {
    const mockOnClose = vi.fn();
    const mockOnNavigate = vi.fn();

    it('renders search input', () => {
        render(<SearchSideBar onClose={mockOnClose} onNavigate={mockOnNavigate} bookId="book1" />);
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
    });

    it('performs search on enter', async () => {
        (searchClient.search as any).mockResolvedValue([
            { href: 'loc1', excerpt: 'This is a test match.' }
        ]);

        render(<SearchSideBar onClose={mockOnClose} onNavigate={mockOnNavigate} bookId="book1" />);
        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(searchClient.search).toHaveBeenCalledWith('test', 'book1');
            expect(screen.getByText('Result 1')).toBeInTheDocument();
        });
    });

    it('navigates on result click', async () => {
        (searchClient.search as any).mockResolvedValue([
             { href: 'loc1', excerpt: 'This is a test match.' }
        ]);

        render(<SearchSideBar onClose={mockOnClose} onNavigate={mockOnNavigate} bookId="book1" />);
        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => screen.getByTestId('search-result-0'));
        fireEvent.click(screen.getByTestId('search-result-0'));

        expect(mockOnNavigate).toHaveBeenCalledWith('loc1');
    });
});
