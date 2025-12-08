import { renderHook, waitFor } from '@testing-library/react';
import { useTTS } from './useTTS';
import { useReaderStore } from '../store/useReaderStore';
import { useTTSStore } from '../store/useTTSStore';
import * as ttsLib from '../lib/tts';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Hoist mock instance
const { mockPlayerInstance } = vi.hoisted(() => {
    return {
        mockPlayerInstance: {
            subscribe: vi.fn(),
            setQueue: vi.fn(),
            stop: vi.fn(),
            generatePreroll: vi.fn()
        }
    };
});

// Mock dependencies
vi.mock('../store/useReaderStore', () => ({
    useReaderStore: vi.fn()
}));
vi.mock('../store/useTTSStore');
vi.mock('../lib/tts/AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: vi.fn(() => mockPlayerInstance)
    }
}));
vi.mock('../lib/tts');

describe('useTTS - No Text Behavior', () => {
    let mockRendition: any;

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Mock Stores
        (useReaderStore as any).mockImplementation((selector: any) => {
             // Mock state selector
             const state = { currentChapterTitle: 'Test Chapter' };
             return selector(state);
        });

        (useTTSStore as any).mockReturnValue({
            loadVoices: vi.fn(),
            prerollEnabled: false,
            rate: 1.0
        });

        // Mock Rendition
        mockRendition = {
            currentLocation: vi.fn().mockReturnValue({ start: { href: 'chapter1.html' } }),
            on: vi.fn(),
            off: vi.fn(),
            getContents: vi.fn().mockReturnValue([{ document: {} }])
        };
    });

    it('should populate queue with a random "no text" message when extraction returns empty', async () => {
        // Mock extraction to return empty array
        (ttsLib.extractSentences as any).mockReturnValue([]);

        renderHook(() => useTTS(mockRendition));

        // Trigger the effect (simulate 'rendered' event)
        const renderCallback = mockRendition.on.mock.calls.find((call: any) => call[0] === 'rendered')[1];
        renderCallback();

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

    it('should NOT populate queue with "no text" message when extraction returns sentences', async () => {
         // Mock extraction to return valid sentences
         const mockSentences = [{ text: 'Hello world', cfi: 'cfi:/1/2' }];
         (ttsLib.extractSentences as any).mockReturnValue(mockSentences);

         renderHook(() => useTTS(mockRendition));

         // Trigger
         const renderCallback = mockRendition.on.mock.calls.find((call: any) => call[0] === 'rendered')[1];
         renderCallback();

         await waitFor(() => {
             expect(mockPlayerInstance.setQueue).toHaveBeenCalled();
         });

         const queueArg = mockPlayerInstance.setQueue.mock.calls[0][0];
         expect(queueArg.length).toBe(1);
         expect(queueArg[0].text).toBe('Hello world');
    });
});
