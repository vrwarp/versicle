import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchPanel, SearchPanelProps } from './SearchPanel';
import { searchClient } from '../../../lib/search';

// Mock the search client
vi.mock('../../../lib/search', () => ({
    searchClient: {
        isIndexed: vi.fn(),
        indexBook: vi.fn(),
        search: vi.fn()
    }
}));

// Mock the toast store
vi.mock('../../../store/useToastStore', () => ({
    useToastStore: vi.fn(() => ({ showToast: vi.fn() }))
}));

describe('SearchPanel', () => {
    const defaultProps: SearchPanelProps = {
        bookId: 'test-book-id',
        book: {} as unknown as import('epubjs').Book,
        onNavigate: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(searchClient.isIndexed).mockReturnValue(true);
        vi.mocked(searchClient.search).mockResolvedValue([]);
    });

    it('renders search panel with input', () => {
        render(<SearchPanel {...defaultProps} />);

        expect(screen.getByTestId('reader-search-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
        expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('shows search query value when typing', () => {
        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });

        expect(input).toHaveValue('test query');
    });

    it('calls searchClient.search when Enter pressed', async () => {
        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(searchClient.search).toHaveBeenCalledWith('test query', 'test-book-id');
        });
    });

    it('calls searchClient.search when search button clicked', async () => {
        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.click(screen.getByLabelText('Search'));

        await waitFor(() => {
            expect(searchClient.search).toHaveBeenCalledWith('test query', 'test-book-id');
        });
    });

    it('disables search button when query is empty', () => {
        render(<SearchPanel {...defaultProps} />);
        expect(screen.getByLabelText('Search')).toBeDisabled();
    });

    it('shows searching indicator while searching', async () => {
        // Delay the search promise to keep it in searching state
        let resolveSearch: (results: unknown[]) => void = () => {};
        vi.mocked(searchClient.search).mockImplementation(() => new Promise(resolve => {
            resolveSearch = resolve;
        }));

        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.click(screen.getByLabelText('Search'));

        const searchingText = await screen.findByText('Searching...');
        expect(searchingText).toBeInTheDocument();
        expect(searchingText).toHaveAttribute('role', 'status');

        resolveSearch([]); // Resolve to cleanup
    });

    it('triggers indexing on mount if not indexed', async () => {
        vi.mocked(searchClient.isIndexed).mockReturnValue(false);
        let resolveIndexing: (value?: void) => void = () => {};
        const indexingPromise = new Promise<void>(resolve => {
            resolveIndexing = resolve;
        });

        vi.mocked(searchClient.indexBook).mockImplementation(async (book, bookId, onProgress) => {
            if (onProgress) {
                onProgress(0.45);
            }
            return indexingPromise as Promise<void>;
        });

        render(<SearchPanel {...defaultProps} />);

        await waitFor(() => {
            expect(searchClient.indexBook).toHaveBeenCalledWith(defaultProps.book, defaultProps.bookId, expect.any(Function));
        });

        const indexingText = await screen.findByText('Indexing book...');
        expect(indexingText).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();

        const progressBar = screen.getByRole('progressbar');
        expect(progressBar).toBeInTheDocument();
        expect(progressBar).toHaveAttribute('aria-valuenow', '45');
        expect(progressBar).toHaveAttribute('aria-valuemin', '0');
        expect(progressBar).toHaveAttribute('aria-valuemax', '100');
        expect(progressBar).toHaveAttribute('aria-label', 'Indexing progress');

        resolveIndexing();
    });

    it('renders search results', async () => {
        const searchResults = [
            { href: 'ch1.xhtml', excerpt: 'This is the first result' },
            { href: 'ch2.xhtml', excerpt: 'This is the second result' }
        ];
        vi.mocked(searchClient.search).mockResolvedValue(searchResults);

        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.click(screen.getByLabelText('Search'));

        await waitFor(() => {
            expect(screen.getByText('This is the first result')).toBeInTheDocument();
            expect(screen.getByText('This is the second result')).toBeInTheDocument();
        });

        expect(screen.getByText('Result 1')).toBeInTheDocument();
        expect(screen.getByText('Result 2')).toBeInTheDocument();
    });

    it('calls onNavigate when result clicked', async () => {
        const searchResults = [
            { href: 'ch1.xhtml', excerpt: 'First result' }
        ];
        vi.mocked(searchClient.search).mockResolvedValue(searchResults);

        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.click(screen.getByLabelText('Search'));

        await waitFor(() => {
            expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByTestId('search-result-0'));
        expect(defaultProps.onNavigate).toHaveBeenCalledWith('ch1.xhtml', 'test query');
    });

    it('shows no results message when search returns empty', async () => {
        vi.mocked(searchClient.search).mockResolvedValue([]);

        render(<SearchPanel {...defaultProps} />);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.click(screen.getByLabelText('Search'));

        const noResults = await screen.findByText('No results found');
        expect(noResults).toBeInTheDocument();
        expect(noResults).toHaveAttribute('role', 'status');
    });

    it('does not show no results message initially', () => {
        render(<SearchPanel {...defaultProps} />);
        expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    });
});
