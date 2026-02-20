import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock device-id before importing the store
vi.mock('../lib/device-id', () => ({
    getDeviceId: vi.fn(() => 'test-device-id')
}));

// Mock cfi-utils to avoid real epub.js interactions
vi.mock('../lib/cfi-utils', () => ({
    mergeCfiRanges: vi.fn((ranges, newRange) => {
        const last = ranges[ranges.length - 1];
        if (last === newRange) return [...ranges];
        return [...ranges, newRange];
    })
}));

import { useReadingStateStore } from './useReadingStateStore';
import { getDeviceId } from '../lib/device-id';

describe('useReadingStateStore - Per-Device Progress', () => {
    beforeEach(() => {
        // Reset the store before each test
        useReadingStateStore.getState().reset();
        vi.mocked(getDeviceId).mockReturnValue('test-device-id');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('updateLocation', () => {
        it('should store progress under the current device ID', () => {
            const bookId = 'book-1';
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/4)', 0.5);

            const state = useReadingStateStore.getState();
            expect(state.progress[bookId]).toBeDefined();
            expect(state.progress[bookId]['test-device-id']).toBeDefined();
            expect(state.progress[bookId]['test-device-id'].percentage).toBe(0.5);
        });

        it('should not overwrite other device progress', () => {
            const bookId = 'book-1';

            // Simulate Device A writing progress
            vi.mocked(getDeviceId).mockReturnValue('device-A');
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/4)', 0.5);

            // Simulate Device B writing progress
            vi.mocked(getDeviceId).mockReturnValue('device-B');
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/2)', 0.1);

            const state = useReadingStateStore.getState();

            // Both devices should have their progress preserved
            expect(state.progress[bookId]['device-A'].percentage).toBe(0.5);
            expect(state.progress[bookId]['device-B'].percentage).toBe(0.1);
        });
    });

    describe('updateReadingSession', () => {
        it('should atomically update location and append history', () => {
            const bookId = 'book-1';
            const updates = [
                { range: 'epubcfi(/6/2)', type: 'page' as const },
                { range: 'epubcfi(/6/4)', type: 'page' as const }
            ];

            useReadingStateStore.getState().updateReadingSession(
                bookId,
                'epubcfi(/6/6)',
                0.75,
                updates
            );

            const state = useReadingStateStore.getState();
            const deviceProgress = state.progress[bookId]['test-device-id'];

            // Check Location Update
            expect(deviceProgress.percentage).toBe(0.75);
            expect(deviceProgress.currentCfi).toBe('epubcfi(/6/6)');

            // Check History Appended
            expect(deviceProgress.readingSessions).toBeDefined();
            expect(deviceProgress.readingSessions!).toHaveLength(2);
            expect(deviceProgress.readingSessions![0].cfiRange).toBe('epubcfi(/6/2)');
            expect(deviceProgress.readingSessions![1].cfiRange).toBe('epubcfi(/6/4)');
        });

        it('should merge completed ranges', () => {
            const bookId = 'book-merge';
            // Setup initial state
            useReadingStateStore.getState().addCompletedRange(bookId, 'epubcfi(/6/2)');

            const updates = [
                { range: 'epubcfi(/6/2)', type: 'page' as const }, // Overlap
                { range: 'epubcfi(/6/6)', type: 'page' as const }  // New
            ];

            useReadingStateStore.getState().updateReadingSession(
                bookId,
                'epubcfi(/6/10)',
                0.5,
                updates
            );

            const state = useReadingStateStore.getState();
            const deviceProgress = state.progress[bookId]['test-device-id'];

            // Completed ranges logic is mocked to merge duplicates
            expect(deviceProgress.completedRanges).toEqual(['epubcfi(/6/2)', 'epubcfi(/6/6)']);

            // Check readingSessions for the append log
            // Logic dedups identical sequential entries, so the first update (same range) merges with initial.
            // Initial: /6/2
            // Update 1: /6/2 (Dedup -> update timestamp)
            // Update 2: /6/6 (Append)
            // Result: 2 sessions
            expect(deviceProgress.readingSessions).toHaveLength(2);
        });
    });

    describe('getProgress', () => {
        it('should prioritize local device progress even if older', () => {
            const bookId = 'book-1';

            // Set progress with Local (Old) and Remote (New)
            vi.mocked(getDeviceId).mockReturnValue('test-device-id');

            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'test-device-id': { // Local
                            bookId,
                            percentage: 0.1, // Old position
                            currentCfi: 'epubcfi(/6/2)',
                            lastRead: Date.now() - 10000,
                            completedRanges: []
                        },
                        'remote-device': { // Remote
                            bookId,
                            percentage: 0.9, // Newer position
                            currentCfi: 'epubcfi(/6/20)',
                            lastRead: Date.now(),
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);

            // Should return Local progress (10%) NOT Remote (90%)
            expect(result).not.toBeNull();
            expect(result?.percentage).toBe(0.1);
        });

        it('should fallback to most recent remote progress if no local state', () => {
            const bookId = 'book-1';
            vi.mocked(getDeviceId).mockReturnValue('test-device-id');

            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'remote-old': {
                            bookId,
                            percentage: 0.5,
                            currentCfi: 'epubcfi(/6/10)',
                            lastRead: Date.now() - 5000,
                            completedRanges: []
                        },
                        'remote-new': {
                            bookId,
                            percentage: 0.8,
                            currentCfi: 'epubcfi(/6/18)',
                            lastRead: Date.now(), // Most Recent
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);

            // Should return Most Recent Remote (80%)
            expect(result).not.toBeNull();
            expect(result?.percentage).toBe(0.8);
        });


        it('should return null for unknown book', () => {
            const result = useReadingStateStore.getState().getProgress('unknown-book');
            expect(result).toBeNull();
        });

        it('should handle single device correctly', () => {
            const bookId = 'book-1';
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/4)', 0.75);

            const result = useReadingStateStore.getState().getProgress(bookId);
            expect(result?.percentage).toBe(0.75);
        });
    });

    describe('useBookProgress hook', () => {
        it('should return most recent progress across devices', () => {
            const bookId = 'book-1';

            // Set progress for multiple devices
            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'device-A': {
                            bookId,
                            percentage: 0.25,
                            currentCfi: 'epubcfi(/6/2)',
                            lastRead: Date.now(), // Newer
                            completedRanges: []
                        },
                        'device-B': {
                            bookId,
                            percentage: 0.75,
                            currentCfi: 'epubcfi(/6/8)',
                            lastRead: Date.now() - 5000, // Older
                            completedRanges: []
                        }
                    }
                }
            });

            // Test the selector function directly
            const selector = (state: ReturnType<typeof useReadingStateStore.getState>) => {
                if (!bookId) return null;
                return state.getProgress(bookId);
            };

            const result = selector(useReadingStateStore.getState());
            expect(result?.percentage).toBe(0.25); // Device A has newer
        });
    });

    describe('Scenario 1: New Device Setup (No Local State)', () => {
        it('should pick up the most recent progress from cloud', () => {
            const bookId = 'test-book';
            const now = Date.now();
            vi.mocked(getDeviceId).mockReturnValue('new-device');

            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'old-phone': {
                            bookId,
                            percentage: 0.3,
                            currentCfi: 'epubcfi(/6/6)',
                            lastRead: now - 10000,
                            completedRanges: []
                        },
                        'tablet': {
                            bookId,
                            percentage: 0.6,
                            currentCfi: 'epubcfi(/6/12)',
                            lastRead: now, // Most Recent
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);
            expect(result?.percentage).toBe(0.6);
        });
    });

    describe('Scenario 2: Existing Device (Has Local State)', () => {
        it('should stick to local progress even if cloud is ahead', () => {
            const bookId = 'test-book';
            const now = Date.now();
            vi.mocked(getDeviceId).mockReturnValue('my-device');

            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'my-device': {
                            bookId,
                            percentage: 0.1, // Valid (> 0.5%)
                            currentCfi: 'epubcfi(/6/2)',
                            lastRead: now - 100000,
                            completedRanges: []
                        },
                        'tablet': {
                            bookId,
                            percentage: 0.9,
                            currentCfi: 'epubcfi(/6/20)',
                            lastRead: now,
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);
            expect(result?.percentage).toBe(0.1);
        });
    });

    describe('Scenario 3: Ignore Tiny Progress (False Starts)', () => {
        it('should ignore local progress if < 0.5% and prefer remote valid progress', () => {
            const bookId = 'test-book';
            const now = Date.now();
            vi.mocked(getDeviceId).mockReturnValue('my-device');

            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'my-device': {
                            bookId,
                            percentage: 0.001, // 0.1% (INVALID)
                            currentCfi: 'epubcfi(/6/2)',
                            lastRead: now, // recent but false start
                            completedRanges: []
                        },
                        'tablet': {
                            bookId,
                            percentage: 0.5, // 50% (VALID)
                            currentCfi: 'epubcfi(/6/20)',
                            lastRead: now - 5000,
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);
            expect(result?.percentage).toBe(0.5); // Should pick Tablet
        });

        it('should return local 0% if NO valid remote progress exists', () => {
            const bookId = 'test-book';
            vi.mocked(getDeviceId).mockReturnValue('my-device');

            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'my-device': {
                            bookId,
                            percentage: 0,
                            currentCfi: '',
                            lastRead: Date.now(),
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);
            expect(result?.percentage).toBe(0);
        });
    });

    describe('History Pruning', () => {
        it('should prune 200 entries when max sessions (500) is exceeded', () => {
            const bookId = 'book-history-test';

            // Fill up to 500 sessions
            const initialSessions = Array.from({ length: 500 }, (_, i) => ({
                cfiRange: `cfi(${i})`,
                timestamp: Date.now() + i,
                type: 'page' as const
            }));

            // Manually inject state
            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'test-device-id': {
                            bookId,
                            percentage: 0.5,
                            currentCfi: 'cfi(500)',
                            lastRead: Date.now(),
                            completedRanges: [],
                            readingSessions: initialSessions
                        }
                    }
                }
            });

            // Verify initial state
            let state = useReadingStateStore.getState();
            expect(state.progress[bookId]['test-device-id'].readingSessions).toHaveLength(500);

            // Add one more session
            useReadingStateStore.getState().addCompletedRange(bookId, 'cfi(501)', 'page');

            // Check new length
            state = useReadingStateStore.getState();
            const sessions = state.progress[bookId]['test-device-id'].readingSessions;

            // Expect to drop to 300 (500 max - 200 deleted)
            expect(sessions).toHaveLength(300);

            // Verify the last one is the new one
            expect(sessions![sessions!.length - 1].cfiRange).toBe('cfi(501)');
        });
    });
});
