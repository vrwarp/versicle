import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';

// Hoist mocks
const { mockPlayerInstance, mockLoadVoices } = vi.hoisted(() => {
    return {
        mockPlayerInstance: {
            subscribe: vi.fn(),
            setQueue: vi.fn(),
            stop: vi.fn(),
            generatePreroll: vi.fn().mockReturnValue("Chapter 1. Estimated reading time: 1 minute."),
            loadSectionBySectionId: vi.fn(),
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
        rate: 1.0,
        status: 'stopped'
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

describe('useTTS', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store mock defaults
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore.getState as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            prerollEnabled: false,
            rate: 1.0,
            status: 'stopped'
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

    it('should request player to load section by ID when idle', async () => {
        renderHook(() => useTTS());

        await waitFor(() => {
            expect(mockPlayerInstance.loadSectionBySectionId).toHaveBeenCalledWith('section1', false);
        });
    });

    it('should NOT request player to load section if playing', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore.getState as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            status: 'playing'
        });

        renderHook(() => useTTS());

        // Wait a bit to ensure it doesn't call
        await new Promise(r => setTimeout(r, 100));

        expect(mockPlayerInstance.loadSectionBySectionId).not.toHaveBeenCalled();
    });

    it('should NOT stop player on unmount', () => {
        const { unmount } = renderHook(() => useTTS());
        unmount();
        expect(mockPlayerInstance.stop).not.toHaveBeenCalled();
    });
});
