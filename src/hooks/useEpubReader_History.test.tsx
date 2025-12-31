import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useEpubReader } from './useEpubReader';
import { dbService } from '../db/DBService';

// Mock DBService
vi.mock('../db/DBService', () => ({
  dbService: {
    getBook: vi.fn(),
    getLocations: vi.fn(),
    saveLocations: vi.fn(),
    getReadingHistory: vi.fn(),
    getReadingHistoryEntry: vi.fn(),
  }
}));

// Mock cfi-utils to avoid dealing with complex CFI parsing in tests
vi.mock('../lib/cfi-utils', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(actual as any),
        parseCfiRange: vi.fn((range: string) => {
            if (range === 'range-old') return { fullEnd: 'cfi-old-end', fullStart: 'cfi-old-start' };
            if (range === 'range-new') return { fullEnd: 'cfi-new-end', fullStart: 'cfi-new-start' };
            // Original test usage
            if (range.includes('epubcfi')) return { fullEnd: 'cfi-original-end', fullStart: 'cfi-original-start' };
            return null;
        }),
        sanitizeContent: (html: string) => html,
        runCancellable: (gen: Generator) => {
             const iter = gen;
             const iterate = async (val?: any) => {
                 const res = iter.next(val);
                 if (!res.done) {
                     if (res.value instanceof Promise) {
                         const result = await res.value;
                         iterate(result);
                     } else {
                         iterate(res.value);
                     }
                 }
             };
             iterate();
             return { cancel: () => {} };
        },
        CancellationError: class CancellationError extends Error {}
    };
});

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
        spread: vi.fn(), // Added mock
        getContents: vi.fn().mockReturnValue([]),
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
            get: vi.fn().mockReturnValue({ label: 'Chapter 1', href: 'chapter1.html' })
        }
    };

    const mockEpub = vi.fn().mockReturnValue(mockBook);
    return {
        default: mockEpub,
    };
});

describe('useEpubReader History Integration', () => {
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

    it('should fallback to legacy spatial range if sessions are missing', async () => {
        const bookId = 'book-123';
        const fileData = new ArrayBuffer(10);
        const metadata = {
            id: bookId,
            title: 'Test Book',
            currentCfi: 'epubcfi(/6/6!/4/2/1:0)', // Start of Chapter
            addedAt: Date.now()
        };

        // Mock getBook to return metadata
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBook as any).mockResolvedValue({
            metadata,
            file: fileData
        });

        const historyRanges = ['epubcfi(/6/6!/4/2/1:0,/1:0,/1:100)'];

        // Mock getReadingHistoryEntry to return ranges but NO sessions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getReadingHistoryEntry as any).mockResolvedValue({
            bookId,
            readRanges: historyRanges,
            sessions: [], // Empty sessions
            lastUpdated: Date.now()
        });

        const { result } = renderHook(() => useEpubReader(bookId, viewerRef, options));

        await waitFor(() => {
            expect(result.current.isReady).toBe(true);
        });

        const rendition = result.current.rendition;
        expect(rendition?.display).toHaveBeenCalled();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const calledArg = (rendition?.display as any).mock.calls[0][0];

        // Should use fullEnd from range (legacy behavior)
        expect(calledArg).toBe('cfi-original-end');
    });

    it('should prefer the last chronological session if available', async () => {
        const bookId = 'book-session-test';

        // Mock getBook
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBook as any).mockResolvedValue({
            metadata: { id: bookId, title: 'Session Test', currentCfi: 'metadata-cfi' },
            file: new ArrayBuffer(10)
        });

        // range-new is spatially after range-old usually, but here we just use names.
        // We put range-old LAST in readRanges (simulating spatial sort end)
        // But we put range-new LAST in sessions (simulating chronological end)
        const historyEntry = {
            bookId,
            readRanges: ['range-new', 'range-old'],
            sessions: [
                { cfiRange: 'range-old', timestamp: 1000, type: 'page' },
                { cfiRange: 'range-new', timestamp: 2000, type: 'page' } // Most recent
            ],
            lastUpdated: 2000
        };

        // Mock getReadingHistoryEntry
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getReadingHistoryEntry as any).mockResolvedValue(historyEntry);

        const { result } = renderHook(() => useEpubReader(bookId, viewerRef, options));

        await waitFor(() => {
            expect(result.current.isReady).toBe(true);
        });

        const rendition = result.current.rendition;
        expect(rendition?.display).toHaveBeenCalled();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const calledArg = (rendition?.display as any).mock.calls[0][0];

        // Should use fullStart from session (new behavior)
        expect(calledArg).toBe('cfi-new-start');
        // If it used the old logic, it would pick 'range-old' -> 'cfi-old-end'
    });
});
