import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn(),
        getBookMetadata: vi.fn(),
        getTTSState: vi.fn(),
        getTTSContent: vi.fn().mockResolvedValue({
            sections: [],
            content: []
        }),
        getContentAnalysis: vi.fn().mockResolvedValue(null),
        getBookStructure: vi.fn().mockResolvedValue({ toc: [] }),
        saveTTSContent: vi.fn()
    }
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn(() => 'web')
    }
}));

vi.mock('./PlatformIntegration', () => {
    return {
        PlatformIntegration: class {
            updateMetadata = vi.fn();
            updatePlaybackState = vi.fn();
            stop = vi.fn().mockResolvedValue(undefined);
            setBackgroundAudioMode = vi.fn();
            setBackgroundVolume = vi.fn();
            setPositionState = vi.fn();
            getBackgroundAudioMode = vi.fn().mockReturnValue(false);
        }
    };
});

vi.mock('./TTSProviderManager', () => {
    return {
        TTSProviderManager: class {
            init = vi.fn();
            stop = vi.fn();
            setProvider = vi.fn();
            getVoices = vi.fn();
            downloadVoice = vi.fn();
            deleteVoice = vi.fn();
            isVoiceDownloaded = vi.fn();
            play = vi.fn();
            pause = vi.fn();
            preload = vi.fn();
        }
    };
});

// Avoid dealing with stores in tests unless needed
vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(() => ({
            updateTTSProgress: vi.fn(),
            getProgress: vi.fn(() => null),
            addCompletedRange: vi.fn()
        }))
    }
}));

describe('AudioPlayerService Predictability', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Since it's a singleton, we might need a fresh instance for tests
        // But for now, we'll try to just grab it
        service = AudioPlayerService.getInstance();
        service.setBookId(null);
    });

    it('should not call a listener if it was unsubscribed before the setTimeout fires', async () => {
        const listener = vi.fn();
        const unsubscribe = service.subscribe(listener);

        // Immediately unsubscribe
        unsubscribe();

        // Wait for next tick where setTimeout inside subscribe would fire
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(listener).not.toHaveBeenCalled();
    });

    it('should not overwrite playlist if setBookId is called again before the first db lookup finishes', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolveFirst: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firstPromise = new Promise<any[]>(r => resolveFirst = r);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolveSecond: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const secondPromise = new Promise<any[]>(r => resolveSecond = r);

        vi.mocked(dbService.getSections)
            .mockReturnValueOnce(firstPromise)
            .mockReturnValueOnce(secondPromise);

        // Call first time
        service.setBookId('book1');

        // Call second time before first resolves
        service.setBookId('book2');

        // Second resolves first (or just correctly updates state)
        resolveSecond([{ sectionId: 's2', title: 'S2' }]);
        await new Promise(resolve => setTimeout(resolve, 10)); // let it settle

        // Now first resolves (stale response)
        resolveFirst([{ sectionId: 's1', title: 'S1' }]);
        await new Promise(resolve => setTimeout(resolve, 10)); // let it settle

        // If we try to load section by ID 's1', it shouldn't try anything because playlist is s2
        // We'll mock getTTSContent to spy
        await service.loadSectionBySectionId('s1');

        expect(dbService.getTTSContent).not.toHaveBeenCalled();
    });
});

describe('AudioPlayerService loadSection Race Condition Fix', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = AudioPlayerService.getInstance();
        service.setBookId(null);
    });

    it('should not continue executing loadSection if bookId changes before playlist resolves', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolveFirst: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firstPromise = new Promise<any[]>(r => resolveFirst = r);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let resolveSecond: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const secondPromise = new Promise<any[]>(r => resolveSecond = r);

        vi.mocked(dbService.getSections)
            .mockReturnValueOnce(firstPromise)
            .mockReturnValueOnce(secondPromise);

        // First book is set. DB request 1 starts.
        service.setBookId('book1');

        // user initiates play on the loading book immediately
        // Wait, loadSection is enqueued. But we want to simulate the user pressing play *before* setBookId('book2') is called.
        // And we want the enqueue to capture originalBookId = 'book1'
        const loadPromise = service.loadSection(0);

        // Context switches rapidly to book2
        service.setBookId('book2');

        // This is the important part! We want to clear the mock of getTTSContent to ensure we are only tracking what happens
        // AFTER the context switches to book2.
        vi.mocked(dbService.getTTSContent).mockClear();

        // Resolve second book request first (simulating faster response for second request)
        resolveSecond([{ sectionId: 's2', title: 'S2' }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        // Now first book request resolves (stale response)
        resolveFirst([{ sectionId: 's1', title: 'S1' }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        await loadPromise;

        // Ensure we do not proceed to try and load TTS content
        // since the context changed to book2 while we were waiting for book1's playlist
        // We only expect getTTSContent to be called with book2 if it does an automatic load, but
        // wait, loadSection(0) was for book1. So we expect getTTSContent NOT to be called with book1!
        expect(dbService.getTTSContent).not.toHaveBeenCalledWith('book1', expect.anything());
    });
});
