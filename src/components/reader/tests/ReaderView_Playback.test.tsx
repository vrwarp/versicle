import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReaderView } from '../ReaderView';
import { useReaderStore } from '../../../store/useReaderStore';
import { useTTSStore } from '../../../store/useTTSStore';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as useEpubReaderModule from '../../../hooks/useEpubReader';

// Hoisted Mocks
const mocks = vi.hoisted(() => {
    return {
        getQueue: vi.fn(),
        jumpTo: vi.fn(),
        getRange: vi.fn(),
        addAnnotation: vi.fn(),
        removeAnnotation: vi.fn(),
        display: vi.fn(),
        prev: vi.fn(),
        next: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        stop: vi.fn(),
        setProvider: vi.fn(),
        init: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getVoices: vi.fn().mockResolvedValue([]),
    };
});

// Mock dependencies
vi.mock('epubjs');
vi.mock('../../../db/DBService', () => ({
  dbService: {
    getReadingHistory: vi.fn().mockResolvedValue([]),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    updateReadingHistory: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    getBookMetadata: vi.fn().mockResolvedValue(null),
    loadAnnotations: vi.fn().mockResolvedValue([]),
  }
}));

vi.mock('../../../lib/search', () => ({
    searchClient: {
        indexBook: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        terminate: vi.fn(),
    }
}));

vi.mock('../../../lib/tts/AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: vi.fn(() => ({
            getQueue: mocks.getQueue,
            jumpTo: mocks.jumpTo,
            setBookId: vi.fn(),
            onSentenceChanged: vi.fn(() => () => {}),
            subscribe: mocks.subscribe,
            stop: mocks.stop,
            setProvider: mocks.setProvider,
            init: mocks.init,
            getVoices: mocks.getVoices,
        }))
    }
}));

const mockRendition = {
    getRange: mocks.getRange,
    annotations: {
        add: mocks.addAnnotation,
        remove: mocks.removeAnnotation,
    },
    display: mocks.display,
    prev: mocks.prev,
    next: mocks.next,
    on: mocks.on,
    off: mocks.off,
};

vi.mock('../../../hooks/useEpubReader', () => ({
    useEpubReader: vi.fn(() => ({
        rendition: mockRendition,
        book: {},
        isReady: true,
        isLoading: false,
        metadata: null,
        error: null
    }))
}));


describe('ReaderView Playback Selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        useReaderStore.setState({
            currentBookId: 'book1',
            isLoading: false,
            currentTheme: 'light',
            fontSize: 100,
            toc: [],
            reset: vi.fn(),
            setToc: vi.fn(),
            updateLocation: vi.fn(),
            setIsLoading: vi.fn(),
            setCurrentBookId: vi.fn(),
        });

        useTTSStore.setState({
            isPlaying: false,
            activeCfi: null,
            queue: [],
        });

        mocks.getQueue.mockReturnValue([]);
    });

    it('skips invalid CFIs and plays from valid match', async () => {
        // Setup Queue
        const queue = [
            { cfi: 'bad-cfi', text: 'Bad' },
            { cfi: 'good-cfi', text: 'Good' }
        ];
        mocks.getQueue.mockReturnValue(queue);

        // Setup Ranges
        mocks.getRange.mockImplementation((cfi) => {
            if (cfi === 'bad-cfi') {
                throw new Error("IndexSizeError: There is no child at offset 328.");
            }
            if (cfi === 'good-cfi') {
                return {
                    compareBoundaryPoints: vi.fn(() => -1) // Starts before selection
                };
            }
            if (cfi === 'selection-cfi') {
                return {}; // selection range
            }
            return null;
        });

        render(
            <MemoryRouter initialEntries={['/read/book1']}>
                <Routes>
                    <Route path="/read/:id" element={<ReaderView />} />
                </Routes>
            </MemoryRouter>
        );

        // ADDED: Inject iframe so showPopover can work
        const container = screen.getByTestId('reader-iframe-container');
        const iframe = document.createElement('iframe');
        container.appendChild(iframe);

        // Retrieve the options passed to useEpubReader
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const useEpubReaderMock = useEpubReaderModule.useEpubReader as any;
        const options = useEpubReaderMock.mock.calls[0][2];

        // Trigger Selection
        const selectionRange = {
            getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 20 }),
            toString: () => "Selected Text"
        };

        act(() => {
            options.onSelection('selection-cfi', selectionRange, {});
        });

        // Click Play
        const playButton = await screen.findByTestId('popover-play-button');
        fireEvent.click(playButton);

        // Assert jumpTo was called with index 1
        expect(mocks.jumpTo).toHaveBeenCalledWith(1);
    });
});
