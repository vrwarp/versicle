import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';

// Mock AudioContentPipeline to avoid circular deps
vi.mock('./AudioContentPipeline', () => ({
    AudioContentPipeline: class {
        loadSection = vi.fn().mockResolvedValue([]);
        triggerNextChapterAnalysis = vi.fn();
    }
}));

// Mock useTTSStore to avoid circular deps
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            // Add any necessary state here
        })),
        subscribe: vi.fn(),
    }
}));

// Mock dependencies
vi.mock('./providers/WebSpeechProvider', () => ({
    WebSpeechProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        stop = vi.fn();
        on = vi.fn();
    }
}));


vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSState: vi.fn(),
        saveTTSState: vi.fn(),
        getSections: vi.fn().mockResolvedValue([]),
    }
}));

// Mock Store
const updateTTSProgressSpy = vi.fn();
vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: () => ({
            updateTTSProgress: updateTTSProgressSpy,
            getProgress: vi.fn()
        })
    }
}));

describe('AudioPlayerService - State Protection', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        // Reset singleton
        // @ts-expect-error Resetting singleton for test
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
        updateTTSProgressSpy.mockClear();
    });

    it('should NOT update reading state when section index is -1 (reset state)', async () => {
        // 1. Set Book ID (triggers reset, expected to NOT update store)
        service.setBookId('book-1');

        // Wait for async operations in setBookId (playlist load)
        await new Promise(resolve => setTimeout(resolve, 10));

        // The reset happening inside setBookId forces sectionIndex to -1.
        // Our fix should prevent updateTTSProgress from being called with these "reset" values.
        expect(updateTTSProgressSpy).not.toHaveBeenCalled();
    });

    it('should update reading state when section index is valid', async () => {
        // 1. Set Book ID
        service.setBookId('book-1');

        // 2. Manually simulate a valid queue load (which updates stateManager)
        // Access private stateManager for testing or use public API
        // Using public setQueue which interacts with StateManager
        const dummyQueue = [{ text: 'test', cfi: 'cfi1', isSkipped: false }];

        // We need to ensure stateManager has a valid section index.
        // setQueue takes (items, startIndex, sectionIndex)
        // This is typically called by loadSectionInternal, but we can call it here via internal access or mock.
        // Let's use the public setQueue, but wait... AudioPlayerService.setQueue() doesn't expose sectionIndex param directly 
        // in strict interface, but let's check the file.
        // AudioPlayerService.ts: setQueue(items: TTSQueueItem[], startIndex: number = 0)
        // It keeps the CURRENT section index. 
        // So we need to set the section index first.

        // The only way to set section index publicly is via loadSection/loadSectionInternal or restoreQueue.
        // Let's mock restoreQueue behavior or use private access.
        // @ts-expect-error Accessing private stateManager for test
        service.stateManager.setQueue(dummyQueue, 0, 5); // Valid section index 5

        // Wait for subscription to fire associated with setQueue
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(updateTTSProgressSpy).toHaveBeenCalledWith('book-1', 0, 5);
    });
});
