import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { PlaybackStateManager } from './PlaybackStateManager';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn().mockResolvedValue([{ sectionId: 'sec1' }, { sectionId: 'sec2' }]),
        getBookMetadata: vi.fn().mockResolvedValue({
            title: 'Test Book'
        }),
        getTTSState: vi.fn(),
        getTTSContent: vi.fn().mockResolvedValue({ sections: [] }),
        updatePlaybackState: vi.fn(),
        saveTTSState: vi.fn()
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

describe('AudioPlayerService Cache-Sync Decoupling Predictability Fix', () => {
    let service: AudioPlayerService;
    let stateManagerSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        service = AudioPlayerService.getInstance();
        service.setBookId(null);

        stateManagerSpy = vi.spyOn((service as any).stateManager, 'setQueue');
    });

    it('should validate sectionIndex from TTSState against currentSectionIndex and discard stale cached queue', async () => {
        const staleCachedSectionIndex = 0;
        const currentSyncedSectionIndex = 1;

        vi.mocked(useReadingStateStore.getState).mockReturnValue({
            updateTTSProgress: vi.fn(),
            getProgress: vi.fn(() => ({
                currentSectionIndex: currentSyncedSectionIndex,
                currentQueueIndex: 0,
                bookId: 'book1',
                percentage: 0.5,
                lastRead: Date.now(),
                completedRanges: []
            })),
            addCompletedRange: vi.fn()
        } as any);

        vi.mocked(dbService.getTTSState).mockResolvedValue({
            bookId: 'book1',
            queue: [{ text: 'Stale text from old chapter', cfi: null }],
            sectionIndex: staleCachedSectionIndex,
            updatedAt: Date.now()
        });

        service.setBookId('book1');

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(stateManagerSpy).not.toHaveBeenCalled();
    });
});
