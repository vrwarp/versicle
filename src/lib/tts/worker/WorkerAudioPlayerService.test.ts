import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerAudioPlayerService } from './WorkerAudioPlayerService';
import { dbService } from '../../../db/DBService';

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
    }
}));

// Mock postMessage
const postMessageSpy = vi.fn();
global.postMessage = postMessageSpy;
// Mock self
global.self = {
    addEventListener: vi.fn(),
    postMessage: postMessageSpy
} as any;


describe('WorkerAudioPlayerService', () => {
    let service: WorkerAudioPlayerService;

    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-expect-error Reset singleton
        WorkerAudioPlayerService.instance = undefined;
        service = WorkerAudioPlayerService.getInstance(false);
    });

    it('should initialize and set provider', async () => {
        await service.init();
        // provider logic is internal but shouldn't crash
    });

    it('should set book ID and load queue', async () => {
        service.setBookId('book1');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(dbService.getSections).toHaveBeenCalledWith('book1');
    });

    it('should load section and play', async () => {
        service.setBookId('book1');
        await service.loadSection(0, true);

        // Should post STATUS_UPDATE
        await new Promise(resolve => setTimeout(resolve, 10));

        const calls = postMessageSpy.mock.calls;
        const statusUpdates = calls.filter((c: any) => c[0].type === 'STATUS_UPDATE');
        expect(statusUpdates.length).toBeGreaterThan(0);

        const lastStatus = statusUpdates[statusUpdates.length - 1][0];
        // It might be 'loading' or 'playing' depending on provider mock speed
        expect(['loading', 'playing']).toContain(lastStatus.status);
    });

    it('should send playback updates', async () => {
        service.setBookId('book1');
        await service.setQueue([{ text: "Test", cfi: "cfi1" }]);
        await service.play();

        expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'STATUS_UPDATE' }));
    });
});
