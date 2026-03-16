import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn(),
        getBookMetadata: vi.fn(),
        getTTSState: vi.fn(),
        getTTSContent: vi.fn().mockResolvedValue({ sections: [] })
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
        let resolveFirst: (value: { sectionId: string; title: string }[]) => void;
        const firstPromise = new Promise<{ sectionId: string; title: string }[]>(r => resolveFirst = r);
        let resolveSecond: (value: { sectionId: string; title: string }[]) => void;
        const secondPromise = new Promise<{ sectionId: string; title: string }[]>(r => resolveSecond = r);

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
