import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';
import { useReadingStateStore } from '../../store/useReadingStateStore';

// Mock dependencies
vi.mock('./providers/WebSpeechProvider', () => ({
    WebSpeechProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        play = vi.fn();
        stop = vi.fn();
        pause = vi.fn();
        resume = vi.fn();
        on = vi.fn();
    }
}));

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSState: vi.fn(),
        saveTTSState: vi.fn(),
        getSections: vi.fn().mockResolvedValue([{ sectionId: 'section-0' }, { sectionId: 'section-1' }, { sectionId: 'section-2' }]),
        getBookMetadata: vi.fn().mockResolvedValue({}), updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    }
}));

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(() => ({
            getProgress: vi.fn()
        })),
        subscribe: vi.fn()
    }
}));

vi.mock('../../store/useBookStore', () => ({
    useBookStore: {
        getState: vi.fn(() => ({ books: {} })),
        subscribe: vi.fn()
    }
}));

vi.mock('../../store/useTTSStore', () => ({
    getDefaultMinSentenceLength: () => 36,
    useTTSStore: {
        getState: vi.fn(() => ({ activeLanguage: 'en' })),
        subscribe: vi.fn()
    }
}));

describe('AudioPlayerService - Cache-Sync Decoupling', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        // @ts-expect-error Reset singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
        vi.clearAllMocks();
    });

    it('discards stale cache when sectionIndex does not match synced progress', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadSectionSpy = vi.spyOn(service as any, 'loadSectionInternal').mockResolvedValue(true);
        const setQueueSpy = vi.spyOn(service.stateManager, 'setQueue');

        // Mock stale cache in IndexedDB: Queue belongs to Section 1
        vi.mocked(dbService.getTTSState).mockResolvedValue({
            bookId: 'book-1',
            queue: [{ text: 'Old queue', cfi: 'old' }],
            sectionIndex: 1, // Stale cache
            updatedAt: Date.now()
        });

        // Mock synced progress in Yjs: User is actually on Section 2
        const getProgressMock = vi.fn().mockReturnValue({
            currentSectionIndex: 2,
            currentQueueIndex: 0
        });
        vi.mocked(useReadingStateStore.getState).mockReturnValue({
            getProgress: getProgressMock,
            updateTTSProgress: vi.fn(),
            updatePlaybackPosition: vi.fn(),
            reset: vi.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // Act: setBookId triggers restoreQueue
        service.setBookId('book-1');

        // Wait for asynchronous restoreQueue execution
        await new Promise(resolve => setTimeout(resolve, 100));

        // Assert
        // 1. The stale queue MUST be discarded
        expect(setQueueSpy).toHaveBeenCalledWith([], 0, 2);

        // 2. The correct section MUST be explicitly loaded
        await new Promise(resolve => setTimeout(resolve, 100));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = (service as any).taskSequencer;
        if (tasks && tasks.taskQueue && tasks.taskQueue.length > 0) {
           await tasks.queue[0];
        }

        expect(loadSectionSpy).toHaveBeenCalled();
    });

    it('restores cache when sectionIndex matches', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadSectionSpy = vi.spyOn(service as any, 'loadSectionInternal').mockResolvedValue(true);
        const setQueueSpy = vi.spyOn(service.stateManager, 'setQueue');

        const mockQueue = [{ text: 'Fresh queue', cfi: 'fresh' }];

        // Cache matches Yjs
        vi.mocked(dbService.getTTSState).mockResolvedValue({
            bookId: 'book-1',
            queue: mockQueue,
            sectionIndex: 2,
            updatedAt: Date.now()
        });

        const getProgressMock = vi.fn().mockReturnValue({
            currentSectionIndex: 2,
            currentQueueIndex: 0
        });
        vi.mocked(useReadingStateStore.getState).mockReturnValue({
            getProgress: getProgressMock,
            updateTTSProgress: vi.fn(),
            updatePlaybackPosition: vi.fn(),
            reset: vi.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // Act
        service.setBookId('book-1');
        await new Promise(resolve => setTimeout(resolve, 100));

        // Assert
        // It should directly apply the cache
        expect(setQueueSpy).toHaveBeenCalledWith(mockQueue, 0, 2);

        // It should NOT load the section anew
        expect(loadSectionSpy).not.toHaveBeenCalled();
    });
});
