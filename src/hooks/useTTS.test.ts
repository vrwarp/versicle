import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { useReadingStateStore } from '../store/useReadingStateStore';

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

vi.mock('../store/useReaderUIStore', () => {
    const mockGetState = vi.fn(() => ({
        currentSectionId: 'section1',
        currentSectionTitle: 'Chapter 1',
        currentBookId: 'book1'
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useReaderUIStore = vi.fn((selector?: any) => {
        const state = mockGetState();
        return selector ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useReaderUIStore as any).getState = mockGetState;
    return { useReaderUIStore };
});

vi.mock('../store/useReadingStateStore', () => {
    const mockGetState = vi.fn(() => ({
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useReadingStateStore = vi.fn((selector?: any) => {
        const state = mockGetState();
        return selector ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useReadingStateStore as any).getState = mockGetState;
    return { useReadingStateStore };
});

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
        (useReaderUIStore.getState as any).mockReturnValue({
            currentSectionId: 'section1',
            currentSectionTitle: 'Chapter 1',
            currentBookId: 'book1'
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useReadingStateStore.getState as any).mockReturnValue({
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
            expect(mockPlayerInstance.loadSectionBySectionId).toHaveBeenCalledWith('section1', false, 'Chapter 1');
        });
    });

    it('should NOT request player to load section if playing', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore.getState as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            status: 'playing',
            isPlaying: true,
            rate: 1.0,
            prerollEnabled: false
        });

        // Mock useTTSStore call too to ensure the hook gets the playing status
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore as any).mockImplementation((selector: any) => {
            const state = {
                loadVoices: mockLoadVoices,
                status: 'playing',
                isPlaying: true,
                rate: 1.0,
                prerollEnabled: false
            };
            return selector ? selector(state) : state;
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
