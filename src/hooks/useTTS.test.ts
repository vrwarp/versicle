import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';

// Hoist mocks
const { mockCommands } = vi.hoisted(() => {
    return {
        mockCommands: {
            loadVoices: vi.fn(),
            clearPauseGesture: vi.fn(),
            loadSectionBySectionId: vi.fn(),
            stop: vi.fn(),
        },
    };
});

// Mock Dependencies — production issues engine commands via useAudioCommands()
// (the TtsController facade; Phase 5b-PR1).
vi.mock('@app/tts/useAudioCommands', () => ({
    useAudioCommands: vi.fn(() => mockCommands),
}));

vi.mock('@store/useTTSPlaybackStore', () => {
    const mockGetState = vi.fn(() => ({
        prerollEnabled: false,
        rate: 1.0,
        status: 'stopped'
    }));

    // The hook function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useTTSPlaybackStore = vi.fn((selector?: any) => {
        const state = mockGetState();
        return selector ? selector(state) : state;
    });
    // Attach static methods
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useTTSPlaybackStore as any).getState = mockGetState;

    return { useTTSPlaybackStore };
});

vi.mock('@store/useReaderUIStore', () => {
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

describe('useTTS', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset store mock defaults
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSPlaybackStore.getState as any).mockReturnValue({
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
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should load voices on mount', () => {
        renderHook(() => useTTS());
        expect(mockCommands.loadVoices).toHaveBeenCalled();
    });

    it('should invalidate the Dragnet pause gesture when the section changes', () => {
        renderHook(() => useTTS());
        expect(mockCommands.clearPauseGesture).toHaveBeenCalled();
    });

    it('should request player to load section by ID when idle', async () => {
        renderHook(() => useTTS());

        await waitFor(() => {
            expect(mockCommands.loadSectionBySectionId).toHaveBeenCalledWith('section1', false, 'Chapter 1');
        });
    });

    it('should NOT request player to load section if playing', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSPlaybackStore.getState as any).mockReturnValue({
            status: 'playing',
            isPlaying: true,
            rate: 1.0,
            prerollEnabled: false
        });

        // Mock useTTSStore call too to ensure the hook gets the playing status
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSPlaybackStore as any).mockImplementation((selector: any) => {
            const state = {
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

        expect(mockCommands.loadSectionBySectionId).not.toHaveBeenCalled();
    });

    it('should NOT stop player on unmount', () => {
        const { unmount } = renderHook(() => useTTS());
        unmount();
        expect(mockCommands.stop).not.toHaveBeenCalled();
    });
});
