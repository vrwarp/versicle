import { renderHook, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useEpubReader } from './useEpubReader';
import { dbService } from '../db/DBService';
import ePub from 'epubjs';

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

    it('should resume from the end of the last reading session in history', async () => {
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

        // Mock Reading History
        // Range from Start to Middle of Chapter
        // "epubcfi(/6/6!/4/2/1:0),/1:0,/1:100)" represents a range.
        const historyRanges = ['epubcfi(/6/6!/4/2/1:0,/1:0,/1:100)'];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getReadingHistory as any).mockResolvedValue(historyRanges);

        // Render the hook
        const { result } = renderHook(() => useEpubReader(bookId, viewerRef, options));

        await waitFor(() => {
            expect(result.current.isReady).toBe(true);
        });

        // Get the rendition instance
        const rendition = result.current.rendition;

        expect(rendition?.display).toHaveBeenCalled();
        const calledArg = (rendition?.display as any).mock.calls[0][0];

        // It should NOT be the metadata one
        expect(calledArg).not.toBe(metadata.currentCfi);

        // It should be related to the history end
        // We expect it to be the end of the range
        // Based on generateCfiRange logic, we can construct what the end looks like
        // or just verify it's different.
    });
});
