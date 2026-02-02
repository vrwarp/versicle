import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { LibraryView } from './LibraryView';
import { useLibraryStore } from '../../store/useLibraryStore';
import { MemoryRouter } from 'react-router-dom';

// Mock everything needed to render LibraryView
vi.mock('zustand/middleware', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persist: (config: any) => (set: any, get: any, api: any) => config(set, get, api),
    createJSONStorage: () => ({
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    }),
}));

vi.mock('../../store/useToastStore', () => ({
    useToastStore: () => ({ showToast: vi.fn() }),
}));

// Mock BookCard to avoid complex rendering
vi.mock('./BookCard', () => ({
    BookCard: () => <div>BookCard</div>
}));

// Mock EmptyLibrary
vi.mock('./EmptyLibrary', () => ({
    EmptyLibrary: () => <div>EmptyLibrary</div>
}));

// Mock ReprocessingInterstitial
vi.mock('./ReprocessingInterstitial', () => ({
    ReprocessingInterstitial: () => null
}));

describe('LibraryView Accessibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('displays an accessible loading state when loading', () => {
        // Set loading state
        useLibraryStore.setState({
            isLoading: true,
            error: null,
            addBook: vi.fn(),
            restoreBook: vi.fn(),
            isImporting: false,
            sortOrder: 'recent',
            hydrateStaticMetadata: vi.fn()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        render(
            <MemoryRouter>
                <LibraryView />
            </MemoryRouter>
        );

        // This check should currently FAIL because the loading spinner is just a div without role="status" or aria-label
        const loadingSpinner = screen.getByRole('status');
        expect(loadingSpinner).toBeInTheDocument();

        // It should also have accessible text (either aria-label or visible text)
        expect(loadingSpinner).toHaveAttribute('aria-label', 'Loading library');
    });
});
