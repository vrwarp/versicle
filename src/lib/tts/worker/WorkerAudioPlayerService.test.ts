import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerAudioPlayerService } from './WorkerAudioPlayerService';
import { dbService } from '../../../db/DBService';
import type { IMainThreadAudioCallback } from './interfaces';

// Mock dependencies
vi.mock('../../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    saveTTSState: vi.fn(),
    getSections: vi.fn().mockResolvedValue([
        { sectionId: 'sec1', characterCount: 100 }
    ]),
    getContentAnalysis: vi.fn().mockResolvedValue({ structure: { title: 'Chapter 1' } }),
    getTTSContent: vi.fn().mockResolvedValue({
        sentences: [{ text: "Sentence 1", cfi: "cfi_1" }]
    }),
    saveTTSPosition: vi.fn(),
    saveContentClassifications: vi.fn(),
    getTableImages: vi.fn().mockResolvedValue([]),
  }
}));

vi.mock('../CostEstimator', () => ({
    useCostStore: {
        subscribe: vi.fn(),
        getState: vi.fn().mockReturnValue({ sessionCharacters: 0 })
    }
}));

vi.mock('../../genai/GenAIService', () => ({
    genAIService: {
        isConfigured: vi.fn().mockReturnValue(true),
        configure: vi.fn(),
        detectContentTypes: vi.fn().mockResolvedValue([])
    }
}));

// Mock Providers to avoid complexity
vi.mock('../providers/WebSpeechProvider', () => ({
    WebSpeechProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        play = vi.fn().mockResolvedValue(undefined);
        stop = vi.fn();
        on = vi.fn();
        pause = vi.fn();
        resume = vi.fn();
        preload = vi.fn().mockResolvedValue(undefined);
    }
}));

vi.mock('./RemoteWebSpeechProvider', () => ({
    RemoteWebSpeechProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        play = vi.fn().mockResolvedValue(undefined);
        stop = vi.fn();
        on = vi.fn();
        pause = vi.fn();
        resume = vi.fn();
        preload = vi.fn().mockResolvedValue(undefined);
    }
}));

vi.mock('./RemoteCapacitorProvider', () => ({
    RemoteCapacitorProvider: class {
        id = 'local';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        play = vi.fn().mockResolvedValue(undefined);
        stop = vi.fn();
        on = vi.fn();
        pause = vi.fn();
        resume = vi.fn();
        preload = vi.fn().mockResolvedValue(undefined);
    }
}));

describe('WorkerAudioPlayerService', () => {
    let service: WorkerAudioPlayerService;
    let mockCallback: IMainThreadAudioCallback;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new WorkerAudioPlayerService();

        mockCallback = {
            onStatusUpdate: vi.fn(),
            onError: vi.fn(),
            onDownloadProgress: vi.fn(),
            playBlob: vi.fn().mockResolvedValue(undefined),
            playLocal: vi.fn().mockResolvedValue(undefined),
            preloadLocal: vi.fn().mockResolvedValue(undefined),
            pausePlayback: vi.fn(),
            resumePlayback: vi.fn(),
            stopPlayback: vi.fn(),
            setPlaybackRate: vi.fn(),
            updateMetadata: vi.fn(),
            updatePlaybackPosition: vi.fn(),
            addCompletedRange: vi.fn(),
            updateHistory: vi.fn(),
            updateCost: vi.fn(),
            getLocalVoices: vi.fn().mockResolvedValue([]),
        };
    });

    it('should initialize and set provider', async () => {
        await service.init(mockCallback, false);
        await service.setProvider('local');
    });

    it('should set book ID and load queue', async () => {
        await service.init(mockCallback, false);
        service.setBookId('book1');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(dbService.getSections).toHaveBeenCalledWith('book1');
    });

    it('should load section and play', async () => {
        await service.init(mockCallback, false);
        await service.setProvider('local');
        service.setBookId('book1');
        await service.loadSection(0, true);

        // Should call onStatusUpdate
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockCallback.onStatusUpdate).toHaveBeenCalled();
        const calls = (mockCallback.onStatusUpdate as any).mock.calls;
        const lastStatus = calls[calls.length - 1][0];
        // It might be 'loading' or 'playing' depending on provider mock speed
        expect(['loading', 'playing']).toContain(lastStatus);
    });

    it('should send playback updates', async () => {
        await service.init(mockCallback, false);
        await service.setProvider('local');
        service.setBookId('book1');
        await service.setQueue([{ text: "Test", cfi: "cfi1" }], 0);
        await service.play();

        expect(mockCallback.onStatusUpdate).toHaveBeenCalled();
    });
});
