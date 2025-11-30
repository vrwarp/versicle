import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore'; // Import useReaderStore
import * as ttsLib from '../lib/tts';

// Hoist the mock instance so it can be used in vi.mock
const { mockPlayerInstance } = vi.hoisted(() => {
    return {
        mockPlayerInstance: {
            subscribe: vi.fn(),
            setQueue: vi.fn(),
            stop: vi.fn(),
            generatePreroll: vi.fn().mockReturnValue("Chapter 1. Estimated reading time: 1 minute."),
        }
    };
});

// Mock AudioPlayerService
vi.mock('../lib/tts/AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: vi.fn(() => mockPlayerInstance)
    }
}));

// Mock Store
vi.mock('../store/useTTSStore');

// Mock Reader Store
vi.mock('../store/useReaderStore', () => ({
    useReaderStore: vi.fn(),
}));

// Mock lib/tts
vi.mock('../lib/tts', async () => {
    const actual = await vi.importActual<typeof import('../lib/tts')>('../lib/tts');
    return {
        ...actual,
        extractSentences: vi.fn(),
    };
});

describe('useTTS', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRendition: any;
    const mockLoadVoices = vi.fn();

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Setup Store mock
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            prerollEnabled: false,
            rate: 1.0
        });

        // Setup Reader Store mock
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useReaderStore as any).mockImplementation((selector: any) => {
             // Mock state selector
             const state = { currentChapterTitle: 'Chapter 1' };
             return selector(state);
        });

        // Mock Rendition
        mockRendition = {
            on: vi.fn(),
            off: vi.fn(),
            getContents: vi.fn().mockReturnValue([]),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should load voices on mount', () => {
        renderHook(() => useTTS(mockRendition));
        expect(mockLoadVoices).toHaveBeenCalled();
    });

    it('should subscribe to rendered event', () => {
        renderHook(() => useTTS(mockRendition));
        expect(mockRendition.on).toHaveBeenCalledWith('rendered', expect.any(Function));
    });

    it('should extract sentences and update player queue when rendered', () => {
        const mockSentences = [{ text: 'Sentence 1', cfi: 'cfi1' }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ttsLib.extractSentences as any).mockReturnValue(mockSentences);

        const { result } = renderHook(() => useTTS(mockRendition));

        // Simulate rendered callback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadSentencesCallback = mockRendition.on.mock.calls.find((call: any) => call[0] === 'rendered')[1];

        act(() => {
            loadSentencesCallback();
        });

        expect(ttsLib.extractSentences).toHaveBeenCalledWith(mockRendition);
        expect(result.current.sentences).toEqual(mockSentences);
        expect(mockPlayerInstance.setQueue).toHaveBeenCalledWith([
            { text: 'Sentence 1', cfi: 'cfi1' }
        ]);
    });

    it('should inject pre-roll if enabled', () => {
         // Override store mock for this test
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore as any).mockReturnValue({
            loadVoices: mockLoadVoices,
            prerollEnabled: true,
            rate: 1.0
        });

        const mockSentences = [{ text: 'Sentence 1', cfi: 'cfi1' }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ttsLib.extractSentences as any).mockReturnValue(mockSentences);

        renderHook(() => useTTS(mockRendition));

        // Simulate rendered callback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadSentencesCallback = mockRendition.on.mock.calls.find((call: any) => call[0] === 'rendered')[1];

        act(() => {
            loadSentencesCallback();
        });

        expect(mockPlayerInstance.generatePreroll).toHaveBeenCalledWith('Chapter 1', 2, 1.0); // 2 words in "Sentence 1"
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
        const { unmount } = renderHook(() => useTTS(mockRendition));
        unmount();
        expect(mockPlayerInstance.stop).toHaveBeenCalled();
    });
});
