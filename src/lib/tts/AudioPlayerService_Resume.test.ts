import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';
import { Capacitor } from '@capacitor/core';

// Mock dependencies
vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn(),
        getTTSState: vi.fn(),
        saveTTSState: vi.fn(),
        saveTTSPosition: vi.fn(),
        getTTSContent: vi.fn(),
        getBookMetadata: vi.fn(),
        getContentAnalysis: vi.fn(),
        updatePlaybackState: vi.fn(),
    }
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false),
        getPlatform: vi.fn().mockReturnValue('web'),
    }
}));

// Mock Providers and other internals
vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      init = vi.fn();
      on = vi.fn();
      stop = vi.fn();
    }
  }
});
vi.mock('./providers/CapacitorTTSProvider', () => {
  return {
    CapacitorTTSProvider: class {
        init = vi.fn();
        on = vi.fn();
        stop = vi.fn();
    }
  }
});
vi.mock('./BackgroundAudio', () => {
    return {
        BackgroundAudio: class {
            play = vi.fn();
            stopWithDebounce = vi.fn();
            forceStop = vi.fn();
            setVolume = vi.fn();
        }
    }
});
vi.mock('./MediaSessionManager', () => {
    return {
        MediaSessionManager: class {
            setMetadata = vi.fn();
            setPlaybackState = vi.fn();
            setPositionState = vi.fn();
        }
    }
});
vi.mock('./SyncEngine', () => {
    return {
        SyncEngine: class {
            setOnHighlight = vi.fn();
            updateTime = vi.fn();
            loadAlignment = vi.fn();
        }
    }
});
vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn().mockReturnValue({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
        })
    }
}));

describe('AudioPlayerService - Resume Logic', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = AudioPlayerService.getInstance();
        service.setBookId(null);
        // @ts-ignore
        service.queue = [];
        // @ts-ignore
        service.currentIndex = 0;
        // @ts-ignore
        service.currentSectionIndex = -1;
    });

    it('should restore queue from DB and preserve index when loading same section without autoplay', async () => {
        const bookId = 'book-123';
        const sectionId = 'sec-1';

        // Mock DB responses
        const mockSections = [
            { sectionId: 'sec-1', characterCount: 100, id: '1', bookId, index: 0, title: 'Chapter 1' },
            { sectionId: 'sec-2', characterCount: 100, id: '2', bookId, index: 1, title: 'Chapter 2' }
        ];
        (dbService.getSections as any).mockResolvedValue(mockSections);

        const mockQueue = [
            { text: 'Sentence 1', cfi: 'cfi1' },
            { text: 'Sentence 2', cfi: 'cfi2' },
            { text: 'Sentence 3', cfi: 'cfi3' }
        ];
        (dbService.getTTSState as any).mockResolvedValue({
            queue: mockQueue,
            currentIndex: 2, // Resumed at index 2
            sectionIndex: 0  // Belongs to section 0 (sec-1)
        });

        (dbService.getTTSContent as any).mockResolvedValue({
            sentences: [
                { text: 'Sentence 1', cfi: 'cfi1' },
                { text: 'Sentence 2', cfi: 'cfi2' },
                { text: 'Sentence 3', cfi: 'cfi3' }
            ]
        });

        (dbService.getBookMetadata as any).mockResolvedValue({ title: 'Test Book' });

        // Step 1: Set Book ID -> triggers restoreQueue
        service.setBookId(bookId);
        // @ts-ignore
        await service.pendingPromise;

        // Verify restoration
        expect(service.getQueue()).toEqual(mockQueue);
        // @ts-ignore
        expect(service.currentIndex).toBe(2);

        // Step 2: Simulate useTTS calling loadSectionBySectionId for the SAME section
        await service.loadSectionBySectionId(sectionId, false);

        // Verify that currentIndex is PRESERVED (still 2, not reset to 0)
        // @ts-ignore
        expect(service.currentIndex).toBe(2);
        expect(dbService.getTTSContent).not.toHaveBeenCalled();
    });

    it('should reload section if index is different', async () => {
        const bookId = 'book-123';
        const sectionId2 = 'sec-2'; // Different section

        const mockSections = [
            { sectionId: 'sec-1', characterCount: 100, id: '1', bookId, index: 0, title: 'Chapter 1' },
            { sectionId: 'sec-2', characterCount: 100, id: '2', bookId, index: 1, title: 'Chapter 2' }
        ];
        (dbService.getSections as any).mockResolvedValue(mockSections);

        const mockQueue = [{ text: 'S1', cfi: 'c1' }];
        (dbService.getTTSState as any).mockResolvedValue({
            queue: mockQueue,
            currentIndex: 0,
            sectionIndex: 0
        });

        (dbService.getTTSContent as any).mockResolvedValue({
            sentences: [{ text: 'S2', cfi: 'c2' }]
        });
        (dbService.getBookMetadata as any).mockResolvedValue({ title: 'Test Book' });

        service.setBookId(bookId);
        // @ts-ignore
        await service.pendingPromise;

        await service.loadSectionBySectionId(sectionId2, false);

        // @ts-ignore
        expect(service.currentSectionIndex).toBe(1);
        // @ts-ignore
        expect(service.currentIndex).toBe(0);
        expect(dbService.getTTSContent).toHaveBeenCalledWith(bookId, sectionId2);
    });
});
