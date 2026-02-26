import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAllBooks } from './selectors';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useLibraryStore } from './useLibraryStore';
import * as deviceIdModule from '../lib/device-id';

// Mock getDeviceId to track calls
vi.mock('../lib/device-id', () => ({
    getDeviceId: vi.fn(() => 'device-id-123'),
    resetDeviceId: vi.fn()
}));

describe('useAllBooks Performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset stores
        useBookStore.setState({ books: {} });
        useReadingStateStore.setState({ progress: {} });
        useLibraryStore.setState({ staticMetadata: {}, offloadedBookIds: new Set() });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should skip resolveProgress (and getDeviceId access) for unchanged books', () => {
        // 1. Setup 10 books with progress
        const books: any = {};
        const progress: any = {};
        const deviceId = 'device-id-123';

        for (let i = 0; i < 10; i++) {
            const id = `book-${i}`;
            books[id] = {
                bookId: id,
                title: `Book ${i}`,
                author: 'Author',
                addedAt: Date.now(),
                lastInteraction: Date.now(), // Important for baseBooks sort stability
                status: 'unread',
                tags: []
            };
            progress[id] = {
                [deviceId]: {
                    bookId: id,
                    percentage: 0.5,
                    lastRead: Date.now(),
                    currentCfi: 'epubcfi(/6/2!/4/2)',
                    completedRanges: []
                }
            };
        }

        useBookStore.setState({ books });
        useReadingStateStore.setState({ progress });

        // Reset spy count before render
        const getDeviceIdSpy = vi.mocked(deviceIdModule.getDeviceId);
        getDeviceIdSpy.mockClear();

        // 2. Render Hook
        const { result } = renderHook(() => useAllBooks());

        // Baseline: 10 calls (1 per book)
        // Note: resolveProgress calls getDeviceId
        expect(getDeviceIdSpy).toHaveBeenCalledTimes(10);

        expect(result.current).toHaveLength(10);

        // 3. Update progress for ONE book
        getDeviceIdSpy.mockClear();

        act(() => {
            useReadingStateStore.setState(state => ({
                progress: {
                    ...state.progress,
                    'book-0': {
                        ...state.progress['book-0'],
                        [deviceId]: {
                            ...state.progress['book-0'][deviceId],
                            percentage: 0.6,
                            lastRead: Date.now() + 1000
                        }
                    }
                }
            }));
        });

        // 4. Assert Performance
        // Without optimization: 10 calls.
        // With optimization: 1 call.
        expect(getDeviceIdSpy).toHaveBeenCalledTimes(1);
    });
});
