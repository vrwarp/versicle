import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { dbService } from '../db/DBService';

// Hoist mocks
const { mockPlayerInstance, mockLoadVoices } = vi.hoisted(() => {
    return {
        mockPlayerInstance: {
            subscribe: vi.fn(),
            setQueue: vi.fn(),
            stop: vi.fn(),
            generatePreroll: vi.fn().mockReturnValue("Chapter 1. Estimated reading time: 1 minute."),
        },
        mockLoadVoices: vi.fn()
    };
});

// Mock Dependencies
vi.mock('../lib/tts/AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: vi.fn(() => mockPlayerInstance)
    }
}));

vi.mock('../store/useTTSStore', () => {
    const mockGetState = vi.fn(() => ({
        loadVoices: mockLoadVoices,
        prerollEnabled: false,
        rate: 1.0
    }));

    // The hook function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useTTSStore = vi.fn((selector?: any) => {
        const state = mockGetState();
        return selector ? selector(state) : state;
    });
    // Attach static methods
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).getState = mockGetState;

    return { useTTSStore };
});

vi.mock('../store/useReaderStore', () => ({
    useReaderStore: vi.fn(),
}));

vi.mock('../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn()
    }
}));

describe('useTTS', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store mock defaults
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore.getState as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            prerollEnabled: false,
            rate: 1.0
        });

        // Setup Reader Store mock
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useReaderStore as any).mockImplementation((selector: any) => {
             const state = {
                 currentBookId: 'book1',
                 currentSectionId: 'section1',
                 currentChapterTitle: 'Chapter 1'
             };
             return selector(state);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should load voices on mount', () => {
        renderHook(() => useTTS());
        expect(mockLoadVoices).toHaveBeenCalled();
    });

    it('should load content from DB and set queue', async () => {
        const mockContent = {
            sentences: [
                { text: 'Sentence 1', cfi: 'cfi1' },
                { text: 'Sentence 2', cfi: 'cfi2' }
            ]
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSContent as any).mockResolvedValue(mockContent);

        const { result } = renderHook(() => useTTS());

        await waitFor(() => {
            expect(result.current.sentences).toHaveLength(2);
        });

        expect(dbService.getTTSContent).toHaveBeenCalledWith('book1', 'section1');
        expect(result.current.sentences).toEqual(mockContent.sentences);
        expect(mockPlayerInstance.setQueue).toHaveBeenCalledWith(mockContent.sentences);
    });

    it('should inject pre-roll if enabled', async () => {
         // Override store mock for this test
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         (useTTSStore.getState as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            prerollEnabled: true,
            rate: 1.0
        });

        const mockContent = {
            sentences: [{ text: 'Sentence 1', cfi: 'cfi1' }]
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSContent as any).mockResolvedValue(mockContent);

        renderHook(() => useTTS());

        await waitFor(() => {
            expect(mockPlayerInstance.setQueue).toHaveBeenCalled();
        });

        expect(mockPlayerInstance.generatePreroll).toHaveBeenCalledWith('Chapter 1', 2, 1.0);
        expect(mockPlayerInstance.setQueue).toHaveBeenCalledWith([
            {
                text: "Chapter 1. Estimated reading time: 1 minute.",
                cfi: null,
                title: 'Chapter 1',
                isPreroll: true
            },
            { text: 'Sentence 1', cfi: 'cfi1' }
        ]);
    });

    it('should stop player on unmount', () => {
        const { unmount } = renderHook(() => useTTS());
        unmount();
        expect(mockPlayerInstance.stop).toHaveBeenCalled();
    });
});
