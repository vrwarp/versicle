/**
 * SearchPanel on the SearchSession (Phase 7 §F reader adoption). The session
 * is REAL with an in-process engine (the PR-0c pattern — no worker, no
 * Comlink); the corpus comes from an injected textSource; the orchestrator
 * reprocess fallback and the toast surface are the only mocks.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchPanel, type SearchPanelProps } from './SearchPanel';
import { SearchSession, type SearchEngineProtocol } from '@domains/search';
import { SearchEngine } from '@lib/search-engine';
import type { CacheSearchTextRow } from '@data/repos/searchText';

const { reprocessBook, showToast } = vi.hoisted(() => ({
    reprocessBook: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('@app/library/useImportController', () => {
    // Stable identity like the real module-level libraryController (the
    // panel's indexing effect depends on it).
    const controller = { reprocessBook };
    return { useImportController: () => controller };
});

vi.mock('@store/useToastStore', () => ({
    useToastStore: vi.fn(() => ({ showToast })),
}));

const BOOK_ID = 'test-book-id';

const corpusRow: CacheSearchTextRow = {
    bookId: BOOK_ID,
    extractionVersion: 3,
    sections: [
        { href: 'ch1.xhtml', title: 'Chapter 1', text: 'This is the first result. And the first again.' },
        { href: 'ch2.xhtml', title: 'Chapter 2', text: 'This is the second result.' },
    ],
};

function makeSession(opts: {
    rows?: Record<string, CacheSearchTextRow | undefined>;
    engine?: SearchEngineProtocol;
    getRow?: (bookId: string) => Promise<CacheSearchTextRow | undefined>;
} = {}): SearchSession {
    return new SearchSession({
        engineFactory: () => ({
            engine: opts.engine ?? new SearchEngine(),
            dispose: vi.fn(),
        }),
        textSource: {
            get: opts.getRow ?? (async (bookId) => (opts.rows ?? { [BOOK_ID]: corpusRow })[bookId]),
        },
    });
}

const renderPanel = (overrides: Partial<SearchPanelProps> = {}) => {
    const props: SearchPanelProps = {
        bookId: BOOK_ID,
        session: makeSession(),
        onNavigate: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<SearchPanel {...props} />) };
};

const awaitIndexed = (session: SearchSession) =>
    waitFor(() => {
        expect(session.isIndexed(BOOK_ID)).toBe(true);
    });

const runSearch = async (query: string, via: 'enter' | 'button' = 'button') => {
    const input = screen.getByTestId('search-input');
    fireEvent.change(input, { target: { value: query } });
    if (via === 'enter') {
        fireEvent.keyDown(input, { key: 'Enter' });
    } else {
        fireEvent.click(screen.getByLabelText('Search'));
    }
};

describe('SearchPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders search panel with input', () => {
        renderPanel();

        expect(screen.getByTestId('reader-search-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
        expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('shows search query value when typing', () => {
        renderPanel();

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'test query' } });

        expect(input).toHaveValue('test query');
    });

    it('indexes from the persisted corpus and renders per-occurrence results (Enter)', async () => {
        const { props } = renderPanel();
        await awaitIndexed(props.session);

        await runSearch('first', 'enter');

        // 'first' occurs twice in ch1 — per-occurrence results, not per-section.
        await waitFor(() => {
            expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
            expect(screen.getByTestId('search-result-1')).toBeInTheDocument();
        });
        expect(screen.getByText(/Result 1$/)).toBeInTheDocument();
        expect(screen.getAllByText(/Chapter 1/)).toHaveLength(2); // section title on every occurrence
    });

    it('searches via the button too', async () => {
        const { props } = renderPanel();
        await awaitIndexed(props.session);

        await runSearch('second');

        await waitFor(() => {
            expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
        });
        expect(screen.getByText(/the second result/)).toBeInTheDocument();
    });

    it('disables search button when query is empty', () => {
        renderPanel();
        expect(screen.getByLabelText('Search')).toBeDisabled();
    });

    it('shows searching indicator while a search is pending', async () => {
        let resolveSearch: (value: { results: never[]; truncated: boolean }) => void = () => {};
        const engine: SearchEngineProtocol = {
            initIndex: () => {},
            addDocuments: () => {},
            rankInt8: () => [],
            searchDetailed: () =>
                new Promise((resolve) => {
                    resolveSearch = resolve;
                }),
        };
        renderPanel({ session: makeSession({ engine }) });

        await runSearch('anything');

        const searchingText = await screen.findByText('Searching...');
        expect(searchingText).toBeInTheDocument();
        expect(searchingText).toHaveAttribute('role', 'status');

        await act(async () => {
            resolveSearch({ results: [], truncated: false });
        });
    });

    it('shows the indexing indicator while the corpus loads', async () => {
        let resolveRow: (row: CacheSearchTextRow) => void = () => {};
        const session = makeSession({
            getRow: () =>
                new Promise((resolve) => {
                    resolveRow = resolve;
                }),
        });
        renderPanel({ session });

        const indexingText = await screen.findByText('Indexing book...');
        expect(indexingText).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Indexing progress');

        await act(async () => {
            resolveRow(corpusRow);
        });
        await waitFor(() => {
            expect(screen.queryByText('Indexing book...')).not.toBeInTheDocument();
        });
    });

    it('no-text: runs ONE reprocess through the orchestrator queue, then retries indexing', async () => {
        // First corpus read: nothing persisted (pre-v26 import). The reprocess
        // "populates" it; the retry read succeeds.
        let populated = false;
        reprocessBook.mockImplementation(async () => {
            populated = true;
        });
        const session = makeSession({
            getRow: async () => (populated ? corpusRow : undefined),
        });
        renderPanel({ session });

        await waitFor(() => {
            expect(reprocessBook).toHaveBeenCalledExactlyOnceWith(BOOK_ID);
        });

        // The retry indexed the freshly persisted corpus: searching works.
        await awaitIndexed(session);
        await runSearch('second');
        await waitFor(() => {
            expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
        });
        expect(showToast).not.toHaveBeenCalled();
    });

    it('no-text after the reprocess fallback surfaces the unavailable toast', async () => {
        reprocessBook.mockResolvedValue(undefined);
        const session = makeSession({ getRow: async () => undefined });
        renderPanel({ session });

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('Search is unavailable for this book', 'error');
        });
    });

    it('hands the FULL DetailedSearchResult to onNavigate on click', async () => {
        const { props } = renderPanel();
        await awaitIndexed(props.session);

        await runSearch('second');
        await waitFor(() => {
            expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByTestId('search-result-0'));
        expect(props.onNavigate).toHaveBeenCalledWith(
            expect.objectContaining({
                href: 'ch2.xhtml',
                charOffset: 12,
                matchLength: 6,
                occurrence: 1,
                sectionTitle: 'Chapter 2',
            }),
        );
    });

    it('says so when results were truncated (no silent cap)', async () => {
        const longText = Array.from({ length: 60 }, (_, i) => `apple number ${i}.`).join(' ');
        const session = makeSession({
            rows: {
                [BOOK_ID]: {
                    bookId: BOOK_ID,
                    extractionVersion: 3,
                    sections: [{ href: 'ch1.xhtml', title: 'Chapter 1', text: longText }],
                },
            },
        });
        renderPanel({ session });
        await awaitIndexed(session);

        await runSearch('apple');
        await waitFor(() => {
            expect(screen.getByText('Showing the first 50 matches')).toBeInTheDocument();
        });
    });

    it('shows no results message when search returns empty', async () => {
        const { props } = renderPanel();
        await awaitIndexed(props.session);

        await runSearch('missingword');

        const noResults = await screen.findByText('No results found');
        expect(noResults).toBeInTheDocument();
        expect(noResults).toHaveAttribute('role', 'status');
    });

    it('does not show no results message initially', () => {
        renderPanel();
        expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    });

    it('shows semantic search status when enabled and configured', async () => {
        const session = makeSession();
        session.getEmbeddingStatus = vi.fn().mockResolvedValue({
            totalSections: 10,
            embeddedSections: 4,
        });

        renderPanel({ session });

        await screen.findByText('Indexing for Semantic Search...');
        expect(screen.getByText('40% (4/10 sections)')).toBeInTheDocument();
    });

    it('shows semantic search ready when fully indexed', async () => {
        const session = makeSession();
        session.getEmbeddingStatus = vi.fn().mockResolvedValue({
            totalSections: 10,
            embeddedSections: 10,
        });

        renderPanel({ session });

        await screen.findByText('Semantic Search Ready');
        expect(screen.getByText('100% of book text indexed by meaning.')).toBeInTheDocument();
    });
});
