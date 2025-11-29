import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReaderView } from '../ReaderView';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useTTSStore } from '../../../store/useTTSStore';
import { useReaderStore } from '../../../store/useReaderStore';
import { useAnnotationStore } from '../../../store/useAnnotationStore';

// Mock dependencies
vi.mock('../../../store/useTTSStore');
vi.mock('../../../store/useReaderStore');
vi.mock('../../../store/useAnnotationStore');

// Mock epub.js
vi.mock('epubjs', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            renderTo: vi.fn().mockReturnValue({
                themes: {
                    register: vi.fn(),
                    select: vi.fn(),
                    fontSize: vi.fn(),
                    font: vi.fn(),
                    default: vi.fn(),
                },
                display: vi.fn(),
                on: vi.fn(),
                spread: vi.fn(),
                resize: vi.fn(),
            }),
            loaded: {
                navigation: Promise.resolve({ toc: [] }),
            },
            ready: Promise.resolve(),
            locations: {
                generate: vi.fn(),
                percentageFromCfi: vi.fn().mockReturnValue(0),
            },
            spine: {
                get: vi.fn().mockReturnValue({ label: 'Chapter 1' }),
                items: [] // Mock items array for search indexing
            },
            destroy: vi.fn(),
            load: vi.fn().mockResolvedValue({ body: { innerText: 'Mock text' } }), // Mock load for search
        })),
    };
});

// Mock hooks
vi.mock('../../../hooks/useTTS', () => ({
    useTTS: () => ({
        // Ensure total chars > 5000
        sentences: Array(100).fill({ text: 'This is a very long sentence that repeats to trigger the cost warning threshold which is set to five thousand characters in the reader view component logic.' }),
    }),
}));

// Mock IndexedDB
vi.mock('../../../db/db', () => ({
    getDB: vi.fn().mockResolvedValue({
        get: vi.fn().mockResolvedValue(new ArrayBuffer(10)), // Return valid buffer
        transaction: vi.fn().mockReturnValue({
             objectStore: vi.fn().mockReturnValue({
                 get: vi.fn().mockResolvedValue({}),
                 put: vi.fn()
             }),
             done: Promise.resolve()
        })
    }),
}));

// Mock Worker
class Worker {
    postMessage() {}
    onmessage() {}
    terminate() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.Worker = Worker as any;


describe('ReaderView Cost Control', () => {
    it('shows cost warning when playing long text with paid provider', async () => {
        // Setup store mocks
        const playMock = vi.fn();
        const setEnableCostWarningMock = vi.fn();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore as any).mockReturnValue({
            isPlaying: false,
            play: playMock,
            pause: vi.fn(),
            providerId: 'google', // Paid provider
            enableCostWarning: true, // Warning enabled
            setEnableCostWarning: setEnableCostWarningMock,
            // Match the hook mock logic roughly if needed, but the component uses the hook directly
            sentences: [],
            voice: null,
            voices: [],
            apiKeys: {},
            lastError: null,
            clearError: vi.fn(),
            queue: [], // Added queue to mock
            currentIndex: 0, // Added currentIndex to mock
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useReaderStore as any).mockReturnValue({
             currentTheme: 'light',
             customTheme: {},
             fontFamily: 'serif',
             fontSize: 100,
             lineHeight: 1.5,
             toc: [],
             updateLocation: vi.fn(),
             setToc: vi.fn(),
             setIsLoading: vi.fn(),
             setCurrentBookId: vi.fn(),
             reset: vi.fn(),
             progress: 0,
             currentChapterTitle: '',
        });

        // Mock annotation store with necessary structure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useAnnotationStore as any).mockReturnValue({
            annotations: [],
            loadAnnotations: vi.fn(),
            showPopover: vi.fn(),
            hidePopover: vi.fn(),
            popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' },
            addAnnotation: vi.fn(),
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
        ttsButton.click();

        // Find Play button
        const playButton = await screen.findByTestId('tts-play-pause-button');

        // Click Play
        playButton.click();

        // Check for Warning Dialog
        expect(await screen.findByText(/Cost Warning/i)).toBeInTheDocument();
        expect(playMock).not.toHaveBeenCalled();

        // Click Proceed
        const proceedButton = screen.getByText('Proceed');
        proceedButton.click();

        // Should call play
        expect(playMock).toHaveBeenCalled();
    });
});
