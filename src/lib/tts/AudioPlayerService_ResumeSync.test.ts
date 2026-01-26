import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';
import { useReadingStateStore } from '../../store/useReadingStateStore';

// --- Mocks ---

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn(),
    saveTTSState: vi.fn(),
    getSections: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn(),
    getTTSContent: vi.fn(),
    updateReadingHistory: vi.fn().mockResolvedValue(undefined),
  }
}));

// Mock useReadingStateStore
const getProgressMock = vi.fn();
const updateTTSProgressMock = vi.fn();

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(() => ({
            getProgress: getProgressMock,
            updateTTSProgress: updateTTSProgressMock
        }))
    }
}));

// Mock Logger
vi.mock('../logger', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    })
}));

// Mock dependencies
vi.mock('./providers/TTSProviderManager', () => ({
    TTSProviderManager: class {
        init = vi.fn();
        stop = vi.fn();
        setProvider = vi.fn();
    }
}));

vi.mock('./PlatformIntegration', () => ({
    PlatformIntegration: class {
        stop = vi.fn().mockResolvedValue(undefined);
        updateMetadata = vi.fn();
        updatePlaybackState = vi.fn();
        setPositionState = vi.fn();
    }
}));

vi.mock('./AudioContentPipeline', () => ({
    AudioContentPipeline: class {
        loadSection = vi.fn();
    }
}));

vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({
             setGlobalBibleLexiconEnabled: vi.fn()
        })
    }
}));


describe('AudioPlayerService - Resume Fix', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        // Reset singleton
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();

        vi.clearAllMocks();
    });

    it('should prioritize store progress if section index matches', async () => {
        const bookId = 'book-123';
        const queueItems = [
            { text: 'Sentence 1', cfi: 'cfi1' },
            { text: 'Sentence 2', cfi: 'cfi2' },
            { text: 'Sentence 3', cfi: 'cfi3' }
        ];

        // 1. Mock DB state (Chapter 1, Index 0)
        vi.mocked(dbService.getTTSState).mockResolvedValue({
            bookId,
            queue: queueItems,
            currentIndex: 0,
            sectionIndex: 1, // Cached queue is for Section 1
            updatedAt: Date.now()
        });

        // 2. Mock Store (Chapter 1, Index 2)
        getProgressMock.mockReturnValue({
            bookId,
            percentage: 0.5,
            currentQueueIndex: 2, // Should resume at sentence 3
            currentSectionIndex: 1, // Matches DB
            lastRead: Date.now(),
            completedRanges: []
        });

        // 3. Trigger restore via setBookId
        service.setBookId(bookId);

        // Wait for event loop
        await new Promise(resolve => setTimeout(resolve, 50));

        // 4. Assert
        const currentIndex = service['stateManager'].currentIndex;
        const currentSectionIndex = service['stateManager'].currentSectionIndex;

        expect(currentIndex).toBe(2);
        expect(currentSectionIndex).toBe(1);
    });

    it('should NOT use store progress if section index mismatches', async () => {
        const bookId = 'book-123';
        const queueItems = [{ text: 'Sentence 1', cfi: 'cfi1' }];

        // 1. Mock DB state (Chapter 1)
        vi.mocked(dbService.getTTSState).mockResolvedValue({
            bookId,
            queue: queueItems,
            currentIndex: 0,
            sectionIndex: 1, // Cached queue is for Section 1
            updatedAt: Date.now()
        });

        // 2. Mock Store (Chapter 2)
        getProgressMock.mockReturnValue({
            bookId,
            percentage: 0.8,
            currentQueueIndex: 5,
            currentSectionIndex: 2, // Mismatch!
            lastRead: Date.now(),
            completedRanges: []
        });

        service.setBookId(bookId);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Should use DB state (Section 1, Index 0)
        expect(service['stateManager'].currentSectionIndex).toBe(1);
        expect(service['stateManager'].currentIndex).toBe(0);
    });

    it('should fallback to DB state if store progress is missing', async () => {
        const bookId = 'book-123';
        const queueItems = [
            { text: 'Sentence 1', cfi: 'cfi1' },
            { text: 'Sentence 2', cfi: 'cfi2' }
        ];

        vi.mocked(dbService.getTTSState).mockResolvedValue({
            bookId,
            queue: queueItems,
            currentIndex: 1,
            sectionIndex: 0,
            updatedAt: Date.now()
        });

        getProgressMock.mockReturnValue(null); // No progress in store

        service.setBookId(bookId);
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(service['stateManager'].currentIndex).toBe(1);
    });
});
