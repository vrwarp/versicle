import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReaderView } from '../ReaderView';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTTSStore } from '../../../store/useTTSStore';
import { useReaderStore } from '../../../store/useReaderStore';
import { useTTS } from '../../../hooks/useTTS';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mocks
vi.mock('../../../store/useTTSStore');
vi.mock('../../../store/useReaderStore');
vi.mock('../../../hooks/useTTS');
vi.mock('../../../db/db', () => ({
  getDB: vi.fn().mockResolvedValue({
      get: vi.fn(),
      put: vi.fn(),
      transaction: vi.fn().mockReturnValue({
          objectStore: vi.fn().mockReturnValue({
              get: vi.fn(),
              put: vi.fn()
          }),
          done: Promise.resolve()
      })
  })
}));
vi.mock('../../../lib/search', () => ({
    searchClient: {
        indexBook: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([])
    }
}));
vi.mock('epubjs', () => {
    return {
        default: vi.fn().mockReturnValue({
            renderTo: vi.fn().mockReturnValue({
                themes: {
                    register: vi.fn(),
                    select: vi.fn(),
                    fontSize: vi.fn(),
                    font: vi.fn(),
                    default: vi.fn()
                },
                display: vi.fn().mockResolvedValue(undefined),
                on: vi.fn(),
                annotations: {
                    add: vi.fn(),
                    remove: vi.fn()
                },
                resize: vi.fn()
            }),
            loaded: {
                navigation: Promise.resolve({ toc: [] })
            },
            ready: Promise.resolve(),
            locations: {
                generate: vi.fn(),
                percentageFromCfi: vi.fn().mockReturnValue(0)
            },
            destroy: vi.fn()
        })
    };
});
// Mock ResizeObserver
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

describe('ReaderView Cost Warning', () => {
    const mockPlay = vi.fn();
    const mockPause = vi.fn();
    const mockSetEnableCostWarning = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useTTSStore as unknown as jest.Mock).mockReturnValue({
            isPlaying: false,
            play: mockPlay,
            pause: mockPause,
            activeCfi: null,
            rate: 1.0,
            voice: null,
            voices: [],
            providerId: 'google', // Paid provider
            apiKeys: { google: 'test-key' },
            enableCostWarning: true,
            setEnableCostWarning: mockSetEnableCostWarning,
            setProviderId: vi.fn(),
            lastError: null,
            clearError: vi.fn(),
            setVoice: vi.fn(),
            setRate: vi.fn(),
            queue: [], // Added queue to avoid undefined error in TTSQueue
            currentIndex: 0,
            jumpTo: vi.fn()
        });

        (useReaderStore as unknown as jest.Mock).mockReturnValue({
            currentTheme: 'light',
            customTheme: {},
            fontFamily: 'Arial',
            lineHeight: 1.5,
            fontSize: 100,
            updateLocation: vi.fn(),
            setToc: vi.fn(),
            setIsLoading: vi.fn(),
            setCurrentBookId: vi.fn(),
            reset: vi.fn(),
            progress: 0,
            currentChapterTitle: 'Chapter 1',
            toc: []
        });

        // Mock hook to return large text
        (useTTS as unknown as jest.Mock).mockReturnValue({
            sentences: [{ text: 'A'.repeat(6000), cfi: 'cfi1' }]
        });
    });

    it('shows warning dialog when text > 5000 chars and provider is paid', async () => {
        render(
            <MemoryRouter initialEntries={['/read/123']}>
                <Routes>
                    <Route path="/read/:id" element={<ReaderView />} />
                </Routes>
            </MemoryRouter>
        );

        // Open TTS panel
        const ttsButton = screen.getByTestId('reader-tts-button');
        fireEvent.click(ttsButton);

        // Click play
        const playButton = screen.getByTestId('tts-play-pause-button');
        fireEvent.click(playButton);

        // Dialog should appear
        expect(screen.getByText('Cost Warning')).toBeInTheDocument();
        // Play should NOT have been called yet
        expect(mockPlay).not.toHaveBeenCalled();

        // Click proceed
        const proceedButton = screen.getByText('Proceed');
        fireEvent.click(proceedButton);

        expect(mockPlay).toHaveBeenCalled();
    });

    it('does not show warning if cost warning is disabled', async () => {
        (useTTSStore as unknown as jest.Mock).mockReturnValue({
            isPlaying: false,
            play: mockPlay,
            pause: mockPause,
            activeCfi: null,
            rate: 1.0,
            voice: null,
            voices: [],
            providerId: 'google',
            apiKeys: { google: 'test-key' },
            enableCostWarning: false, // DISABLED
            setEnableCostWarning: mockSetEnableCostWarning,
            setProviderId: vi.fn(),
            lastError: null,
            clearError: vi.fn(),
            setVoice: vi.fn(),
            setRate: vi.fn(),
            queue: [],
            currentIndex: 0,
            jumpTo: vi.fn()
        });

        render(
            <MemoryRouter initialEntries={['/read/123']}>
                <Routes>
                    <Route path="/read/:id" element={<ReaderView />} />
                </Routes>
            </MemoryRouter>
        );

        // Open TTS panel
        const ttsButton = screen.getByTestId('reader-tts-button');
        fireEvent.click(ttsButton);

        const playButton = screen.getByTestId('tts-play-pause-button');
        fireEvent.click(playButton);

        expect(screen.queryByText('Cost Warning')).toBeNull();
        expect(mockPlay).toHaveBeenCalled();
    });

    it('does not show warning if text is small', async () => {
        (useTTS as unknown as jest.Mock).mockReturnValue({
            sentences: [{ text: 'Small text', cfi: 'cfi1' }]
        });

        render(
            <MemoryRouter initialEntries={['/read/123']}>
                <Routes>
                    <Route path="/read/:id" element={<ReaderView />} />
                </Routes>
            </MemoryRouter>
        );

        const ttsButton = screen.getByTestId('reader-tts-button');
        fireEvent.click(ttsButton);

        const playButton = screen.getByTestId('tts-play-pause-button');
        fireEvent.click(playButton);

        expect(screen.queryByText('Cost Warning')).toBeNull();
        expect(mockPlay).toHaveBeenCalled();
    });

     it('does not show warning if provider is local', async () => {
        (useTTSStore as unknown as jest.Mock).mockReturnValue({
            isPlaying: false,
            play: mockPlay,
            pause: mockPause,
            activeCfi: null,
            rate: 1.0,
            voice: null,
            voices: [],
            providerId: 'local', // LOCAL
            apiKeys: { google: 'test-key' },
            enableCostWarning: true,
            setEnableCostWarning: mockSetEnableCostWarning,
            setProviderId: vi.fn(),
            lastError: null,
            clearError: vi.fn(),
            setVoice: vi.fn(),
            setRate: vi.fn(),
            queue: [],
            currentIndex: 0,
            jumpTo: vi.fn()
        });

        render(
            <MemoryRouter initialEntries={['/read/123']}>
                <Routes>
                    <Route path="/read/:id" element={<ReaderView />} />
                </Routes>
            </MemoryRouter>
        );

        const ttsButton = screen.getByTestId('reader-tts-button');
        fireEvent.click(ttsButton);

        const playButton = screen.getByTestId('tts-play-pause-button');
        fireEvent.click(playButton);

        expect(screen.queryByText('Cost Warning')).toBeNull();
        expect(mockPlay).toHaveBeenCalled();
    });
});
