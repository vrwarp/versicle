import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock device-id before importing the store
vi.mock('../lib/device-id', () => ({
    getDeviceId: vi.fn(() => 'test-device-id')
}));

import { useReadingStateStore, useBookProgress, useCurrentDeviceProgress } from './useReadingStateStore';
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

    describe('getProgress', () => {
        it('should return the progress with highest percentage (max strategy)', () => {
            const bookId = 'book-1';

            // Set progress for multiple devices
            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'device-A': {
                            bookId,
                            percentage: 0.5,
                            currentCfi: 'epubcfi(/6/4)',
                            lastRead: Date.now() - 1000,
                            completedRanges: []
                        },
                        'device-B': {
                            bookId,
                            percentage: 0.1,
                            currentCfi: 'epubcfi(/6/2)',
                            lastRead: Date.now(),
                            completedRanges: []
                        }
                    }
                }
            });

            const result = useReadingStateStore.getState().getProgress(bookId);

            // Should return Device A's progress (50%) not Device B's (10%)
            expect(result).not.toBeNull();
            expect(result?.percentage).toBe(0.5);
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
        it('should return max progress across devices', () => {
            const bookId = 'book-1';

            // Set progress for multiple devices
            useReadingStateStore.setState({
                progress: {
                    [bookId]: {
                        'device-A': {
                            bookId,
                            percentage: 0.25,
                            currentCfi: 'epubcfi(/6/2)',
                            lastRead: Date.now(),
                            completedRanges: []
                        },
                        'device-B': {
                            bookId,
                            percentage: 0.75,
                            currentCfi: 'epubcfi(/6/8)',
                            lastRead: Date.now() - 5000,
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
            expect(result?.percentage).toBe(0.75); // Device B has highest
        });
    });

    describe('Scenario 1: Cross-device progress conflict', () => {
        it('Device A (50%) vs Device B (10%) should return 50% (max strategy)', () => {
            const bookId = 'test-book';

            // Device A reads to 50%
            vi.mocked(getDeviceId).mockReturnValue('device-A');
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/10)', 0.5);

            // Device B reads to 10%
            vi.mocked(getDeviceId).mockReturnValue('device-B');
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/2)', 0.1);

            // The max progress should be 50%
            const progress = useReadingStateStore.getState().getProgress(bookId);
            expect(progress?.percentage).toBe(0.5);
        });

        it('should preserve CFI from the max-progress device', () => {
            const bookId = 'test-book';

            vi.mocked(getDeviceId).mockReturnValue('device-A');
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/50)', 0.5);

            vi.mocked(getDeviceId).mockReturnValue('device-B');
            useReadingStateStore.getState().updateLocation(bookId, 'epubcfi(/6/10)', 0.1);

            const progress = useReadingStateStore.getState().getProgress(bookId);
            expect(progress?.currentCfi).toBe('epubcfi(/6/50)');
        });
    });
});
