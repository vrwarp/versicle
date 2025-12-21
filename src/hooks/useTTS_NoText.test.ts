/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useReaderStore } from '../store/useReaderStore';
import { useTTSStore } from '../store/useTTSStore';
import { dbService } from '../db/DBService';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Hoist mock instance
const { mockPlayerInstance, mockLoadVoices } = vi.hoisted(() => {
    return {
        mockPlayerInstance: {
            subscribe: vi.fn(),
            setQueue: vi.fn(),
            stop: vi.fn(),
            generatePreroll: vi.fn()
        },
        mockLoadVoices: vi.fn()
    };
});

// Mock dependencies
vi.mock('../store/useReaderStore', () => ({
    useReaderStore: vi.fn()
}));

vi.mock('../store/useTTSStore', () => {
    const mockGetState = vi.fn(() => ({
        loadVoices: mockLoadVoices,
        prerollEnabled: false,
        rate: 1.0
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useTTSStore = vi.fn((selector?: any) => {
        const state = mockGetState();
        return selector ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSStore as any).getState = mockGetState;
    return { useTTSStore };
});

vi.mock('../lib/tts/AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: vi.fn(() => mockPlayerInstance)
    }
}));

vi.mock('../db/DBService', () => ({
    dbService: {
        getTTSContent: vi.fn()
    }
}));

describe('useTTS - No Text Behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        (useReaderStore as any).mockImplementation((selector: any) => {
             const state = {
                currentBookId: 'book1',
                currentSectionId: 'section1',
                currentChapterTitle: 'Test Chapter'
             };
             return selector(state);
        });

        // Default: no preroll
        (useTTSStore.getState as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            prerollEnabled: false,
            rate: 1.0
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should populate queue with a random "no text" message when DB returns empty content', async () => {
        // Mock DB returning empty sentences
        const mockContent = {
            sentences: []
        };
        (dbService.getTTSContent as any).mockResolvedValue(mockContent);

        renderHook(() => useTTS());

        await waitFor(() => {
            expect(mockPlayerInstance.setQueue).toHaveBeenCalled();
        });

        const queueArg = mockPlayerInstance.setQueue.mock.calls[0][0];
        expect(queueArg.length).toBe(1);
        expect(queueArg[0].cfi).toBeNull();
        expect(typeof queueArg[0].text).toBe('string');
        expect(queueArg[0].text.length).toBeGreaterThan(0);
        console.log("Generated message:", queueArg[0].text);
    });

    it('should NOT populate queue with "no text" message when DB returns sentences', async () => {
         // Mock DB returning valid sentences
         const mockContent = {
            sentences: [{ text: 'Hello world', cfi: 'cfi:/1/2' }]
         };
         (dbService.getTTSContent as any).mockResolvedValue(mockContent);

         renderHook(() => useTTS());

         await waitFor(() => {
             expect(mockPlayerInstance.setQueue).toHaveBeenCalled();
         });

         const queueArg = mockPlayerInstance.setQueue.mock.calls[0][0];
         expect(queueArg.length).toBe(1);
         expect(queueArg[0].text).toBe('Hello world');
    });
});
