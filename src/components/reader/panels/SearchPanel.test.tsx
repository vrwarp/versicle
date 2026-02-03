import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchPanel, SearchPanelProps } from './SearchPanel';

describe('SearchPanel', () => {
    const defaultProps: SearchPanelProps = {
        searchQuery: '',
        onSearchQueryChange: vi.fn(),
        onSearch: vi.fn(),
        isSearching: false,
        searchResults: [],
        activeSearchQuery: '',
        isIndexing: false,
        indexingProgress: 0,
        onResultClick: vi.fn()
    };

    it('renders search panel with input', () => {
        render(<SearchPanel {...defaultProps} />);

        expect(screen.getByTestId('reader-search-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
        expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('shows search query value', () => {
        render(<SearchPanel {...defaultProps} searchQuery="test query" />);

        expect(screen.getByTestId('search-input')).toHaveValue('test query');
    });

    it('calls onSearchQueryChange when typing', () => {
        const onSearchQueryChange = vi.fn();
        render(<SearchPanel {...defaultProps} onSearchQueryChange={onSearchQueryChange} />);

        fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'new query' } });
        expect(onSearchQueryChange).toHaveBeenCalledWith('new query');
    });

    it('calls onSearch when Enter pressed', () => {
        const onSearch = vi.fn();
        render(<SearchPanel {...defaultProps} searchQuery="test" onSearch={onSearch} />);

        fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Enter' });
        expect(onSearch).toHaveBeenCalled();
    });

    it('calls onSearch when search button clicked', () => {
        const onSearch = vi.fn();
        render(<SearchPanel {...defaultProps} searchQuery="test" onSearch={onSearch} />);

        fireEvent.click(screen.getByLabelText('Search'));
        expect(onSearch).toHaveBeenCalled();
    });

    it('disables search button when query is empty', () => {
        render(<SearchPanel {...defaultProps} searchQuery="" />);

        expect(screen.getByLabelText('Search')).toBeDisabled();
    });

    it('disables search button while searching', () => {
        render(<SearchPanel {...defaultProps} searchQuery="test" isSearching={true} />);

        expect(screen.getByLabelText('Search')).toBeDisabled();
    });

    it('shows searching indicator', () => {
        render(<SearchPanel {...defaultProps} isSearching={true} />);

        expect(screen.getByText('Searching...')).toBeInTheDocument();
    });

    it('shows indexing progress', () => {
        render(<SearchPanel {...defaultProps} isIndexing={true} indexingProgress={45} />);

        expect(screen.getByText('Indexing book...')).toBeInTheDocument();
        expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('renders search results', () => {
        const searchResults = [
            { href: 'ch1.xhtml', excerpt: 'This is the first result' },
            { href: 'ch2.xhtml', excerpt: 'This is the second result' }
        ];
        render(<SearchPanel {...defaultProps} searchResults={searchResults} />);

        expect(screen.getByText('This is the first result')).toBeInTheDocument();
        expect(screen.getByText('This is the second result')).toBeInTheDocument();
        expect(screen.getByText('Result 1')).toBeInTheDocument();
        expect(screen.getByText('Result 2')).toBeInTheDocument();
    });

    it('calls onResultClick when result clicked', () => {
        const onResultClick = vi.fn();
        const searchResults = [
            { href: 'ch1.xhtml', excerpt: 'First result' }
        ];
        render(<SearchPanel {...defaultProps} searchResults={searchResults} onResultClick={onResultClick} />);

        fireEvent.click(screen.getByTestId('search-result-0'));
        expect(onResultClick).toHaveBeenCalledWith(searchResults[0]);
    });

    it('shows no results message when search returns empty', () => {
        render(<SearchPanel {...defaultProps} searchResults={[]} activeSearchQuery="test" />);

        expect(screen.getByText('No results found')).toBeInTheDocument();
    });

    it('does not show no results message when query is empty', () => {
        render(<SearchPanel {...defaultProps} searchResults={[]} activeSearchQuery="" />);

        expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    });
});
