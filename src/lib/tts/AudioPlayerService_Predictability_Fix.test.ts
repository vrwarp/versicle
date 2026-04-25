import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn().mockResolvedValue([]),
        getBookMetadata: vi.fn().mockResolvedValue({
            title: 'Test Book',
            author: 'Test Author',
            coverUrl: 'http://example.com/cover.jpg'
        }),
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

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(() => ({
            updateTTSProgress: vi.fn(),
            getProgress: vi.fn(() => null),
            addCompletedRange: vi.fn()
        }))
    }
}));

describe('AudioPlayerService Predictability Fix', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = AudioPlayerService.getInstance();
        service.setBookId(null);
    });

    it('reproduces and fixes the predictability problem where loadSectionBySectionId continues executing after bookId changes', async () => {
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

        // Call second time before first resolves, changing the context.
        service.setBookId('book2');

        // Resolve second book request first
        resolveSecond([{ sectionId: 's2', title: 'S2' }]);
        await new Promise(resolve => setTimeout(resolve, 10)); // let it settle

        // Now first book request resolves (stale response)
        resolveFirst([{ sectionId: 's1', title: 'S1' }]);
        await new Promise(resolve => setTimeout(resolve, 10)); // let it settle

        // If we try to load section by ID 's1' (from book1), it should immediately return
        // without attempting to invoke the dbService or mutating the state, because
        // currentBookId is now 'book2'.
        await service.loadSectionBySectionId('s1');

        expect(dbService.getTTSContent).not.toHaveBeenCalled();
    });
});
