import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useEpubReader } from './useEpubReader';
import { dbService } from '../db/DBService';
import type { BookMetadata } from '../types/db';

// Mock DBService
vi.mock('../db/DBService', () => ({
  dbService: {
    getBook: vi.fn(),
    getLocations: vi.fn(),
    saveLocations: vi.fn(),
    getReadingHistory: vi.fn(),
  }
}));

// Mock epubjs
vi.mock('epubjs', () => {
    const mockRendition = {
        themes: {
            register: vi.fn(),
            select: vi.fn(),
            fontSize: vi.fn(),
            font: vi.fn(),
            default: vi.fn(),
        },
        display: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        hooks: {
            content: {
                register: vi.fn(),
            }
        },
        flow: vi.fn(),
        spread: vi.fn(),
        getContents: vi.fn().mockReturnValue([]),
        resize: vi.fn(),
        destroy: vi.fn(),
        location: {
             start: { cfi: 'test-cfi', href: 'chapter1.html' }
        }
    };

    const mockBook = {
        renderTo: vi.fn().mockReturnValue(mockRendition),
        ready: Promise.resolve(),
        destroy: vi.fn(),
        loaded: {
            navigation: Promise.resolve({ toc: [] })
        },
        locations: {
            load: vi.fn(),
            generate: vi.fn().mockResolvedValue(undefined),
            save: vi.fn().mockReturnValue('locations-string'),
            percentageFromCfi: vi.fn().mockReturnValue(0.5),
        },
        spine: {
            get: vi.fn().mockReturnValue({ label: 'Chapter 1', href: 'chapter1.html' }),
            hooks: {}
        }
    };

    const mockEpub = vi.fn().mockReturnValue(mockBook);
    return {
        default: mockEpub,
    };
});

describe('useEpubReader Race Condition', () => {
    const viewerRef = { current: document.createElement('div') };
    const options = {
        viewMode: 'paginated' as const,
        currentTheme: 'light',
        customTheme: { bg: '#fff', fg: '#000' },
        fontFamily: 'serif',
        fontSize: 100,
        lineHeight: 1.5,
        shouldForceFont: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should ignore results from cancelled load requests', async () => {
        let resolveBook1: (val: { file: ArrayBuffer; metadata: BookMetadata }) => void = () => {};
        let resolveBook2: (val: { file: ArrayBuffer; metadata: BookMetadata }) => void = () => {};

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBook as any).mockImplementation((id: string) => {
            if (id === 'book-1') {
                return new Promise(resolve => {
                    resolveBook1 = resolve;
                });
            }
            if (id === 'book-2') {
                 return new Promise(resolve => {
                    resolveBook2 = resolve;
                });
            }
            return Promise.reject('Unknown book');
        });

        // Start loading Book 1
        const { result, rerender } = renderHook(
            ({ id }) => useEpubReader(id, viewerRef, options),
            { initialProps: { id: 'book-1' } }
        );

        // Initially loading
        expect(result.current.isLoading).toBe(true);

        // Switch to Book 2 immediately (triggering cleanup for Book 1)
        rerender({ id: 'book-2' });

        // Resolve Book 2 first
        const book2Data = {
            metadata: { id: 'book-2', title: 'Book 2' } as unknown as BookMetadata,
            file: new ArrayBuffer(10)
        };

        await act(async () => {
             resolveBook2(book2Data);
        });

        // Wait for Book 2 to be ready
        await waitFor(() => {
            expect(result.current.isReady).toBe(true);
            expect(result.current.metadata?.id).toBe('book-2');
        });

        // Now Resolve Book 1 (which was the first request, but is now "stale")
        // This simulates a network request finishing late after component unmount/update
        const book1Data = {
            metadata: { id: 'book-1', title: 'Book 1' } as unknown as BookMetadata,
            file: new ArrayBuffer(10)
        };

        await act(async () => {
            resolveBook1(book1Data);
        });

        // Ensure state is STILL Book 2
        // IF THE BUG EXISTS: This expectation might fail because Book 1 overwrote state
        expect(result.current.metadata?.id).toBe('book-2');
    });
});
