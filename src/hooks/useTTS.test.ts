import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useTTSStore } from '../store/useTTSStore';

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
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should load voices on mount', () => {
        renderHook(() => useTTS());
        expect(mockLoadVoices).toHaveBeenCalled();
    });

    it('should NOT load content from DB', () => {
        renderHook(() => useTTS());
        // Since we removed DB loading logic, setQueue should not be called
        expect(mockPlayerInstance.setQueue).not.toHaveBeenCalled();
    });

    it('should stop player on unmount', () => {
        const { unmount } = renderHook(() => useTTS());
        unmount();
        expect(mockPlayerInstance.stop).toHaveBeenCalled();
    });
});
