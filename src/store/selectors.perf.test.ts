import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAllBooks } from './selectors';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useLibraryStore } from './useLibraryStore';
import { useReadingListStore } from './useReadingListStore';
import * as deviceIdModule from '../lib/device-id';
import * as entityResolutionModule from '../lib/entity-resolution';
import type { UserInventoryItem, UserProgress } from '../types/db';

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
        useReadingListStore.setState({ entries: {} });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should skip resolveProgress (and getDeviceId access) for unchanged books', () => {
        // 1. Setup 10 books with progress
        const books: Record<string, UserInventoryItem> = {};
        const progress: Record<string, Record<string, UserProgress>> = {};
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

        // Baseline: 1 call (we optimized this to run only once per hook call instead of per book)
        // Note: resolveProgress no longer calls getDeviceId
        expect(getDeviceIdSpy).toHaveBeenCalledTimes(1);

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
        // Without optimization: 10 calls per render.
        // With optimization: 1 call per render.
        expect(getDeviceIdSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip reading list fallback matching (generateMatchKey) when only progress changes', () => {
        // Setup a book that requires fallback matching (no sourceFilename)
        const books: Record<string, UserInventoryItem> = {
            'book-1': {
                bookId: 'book-1',
                title: 'A Very Unique Book Title',
                author: 'Jane Doe',
                addedAt: Date.now(),
                lastInteraction: Date.now(),
                status: 'unread',
                tags: []
            }
        };

        const progress: Record<string, Record<string, UserProgress>> = {
            'book-1': {
                'device-id-123': {
                    bookId: 'book-1',
                    percentage: 0.1,
                    lastRead: Date.now(),
                    currentCfi: '',
                    completedRanges: []
                }
            }
        };

        useBookStore.setState({ books });
        useReadingStateStore.setState({ progress });
        useReadingListStore.setState({
            entries: {
                // An entry that will match via fallback (title/author)
                'some-unknown-file.epub': {
                    filename: 'some-unknown-file.epub',
                    title: 'A Very Unique Book Title',
                    author: 'Jane Doe',
                    percentage: 0.5,
                    lastUpdated: Date.now(),
                    order: 1,
                    type: 'epub'
                }
            }
        });

        // Spy on generateMatchKey
        const generateMatchKeySpy = vi.spyOn(entityResolutionModule, 'generateMatchKey');
        generateMatchKeySpy.mockClear();

        // 1. Initial Render
        const { result } = renderHook(() => useAllBooks());

        // Should have called generateMatchKey to build the readingListMatchMap AND to do the fallback match
        expect(generateMatchKeySpy).toHaveBeenCalled();
        expect(result.current[0].progress).toBe(0.1); // from progressMap

        // Clear spy before update
        generateMatchKeySpy.mockClear();

        // 2. Update progress (simulate reading)
        act(() => {
            useReadingStateStore.setState(state => ({
                progress: {
                    ...state.progress,
                    'book-1': {
                        ...state.progress['book-1'],
                        'device-id-123': {
                            ...state.progress['book-1']['device-id-123'],
                            percentage: 0.2
                        }
                    }
                }
            }));
        });

        // 3. Assert Performance
        // Without optimization: generateMatchKey would be called again because rawReadingListEntry
        // is re-evaluated for all books in the loop.
        // With optimization: generateMatchKey is NOT called because readingListEntries didn't change!
        expect(generateMatchKeySpy).not.toHaveBeenCalled();
        expect(result.current[0].progress).toBe(0.2);
    });
});
