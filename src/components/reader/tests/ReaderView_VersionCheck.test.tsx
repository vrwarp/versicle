import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ReaderView } from '../ReaderView';
import { useEpubReader } from '../../../hooks/useEpubReader';
import { CURRENT_BOOK_VERSION } from '../../../lib/constants';

// Mocks
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: vi.fn(),
        useParams: () => ({ id: 'book-123' })
    };
});

vi.mock('../../../hooks/useEpubReader');
vi.mock('../../../store/useReaderUIStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useReaderUIStore: (selector: any) => selector({
        setToc: vi.fn(),
        setIsLoading: vi.fn(),
        reset: vi.fn(),
        setImmersiveMode: vi.fn(),
        immersiveMode: false,
        setPlayFromSelection: vi.fn(),
        currentSectionTitle: null,
        currentSectionId: null,
        setCurrentSection: vi.fn(),
        setCurrentBookId: vi.fn(),
        playFromSelection: null
    })
}));
vi.mock('../../../store/usePreferencesStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usePreferencesStore: (selector: any) => selector({
        currentTheme: 'light',
        customTheme: null,
        fontFamily: 'serif',
        lineHeight: 1.5,
        fontSize: 100,
        shouldForceFont: false,
        readerViewMode: 'paginated'
    })
}));
const MOCK_PROGRESS = { completedRanges: [] };
vi.mock('../../../store/useReadingStateStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useReadingStateStore: (selector: any) => selector({
        updateLocation: vi.fn(),
        reset: vi.fn(),
        progress: {},
        getProgress: () => null
    }),
    useBookProgress: vi.fn(() => MOCK_PROGRESS)
}));
vi.mock('../../../store/useTTSStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useTTSStore: (selector: any) => selector({
        isPlaying: false,
        lastError: null,
        clearError: vi.fn(),
        status: 'stopped'
    })
}));
vi.mock('../../../store/useUIStore', () => ({
    useUIStore: () => ({
        setGlobalSettingsOpen: vi.fn()
    })
}));
vi.mock('../../../store/useAnnotationStore', () => ({
    useAnnotationStore: () => ({
        annotations: [],
        loadAnnotations: vi.fn(),
        showPopover: vi.fn(),
        hidePopover: vi.fn(),
        popover: { visible: false }
    })
}));
vi.mock('../../../store/useGenAIStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useGenAIStore: (selector: any) => selector({
        isDebugModeEnabled: false
    })
}));
vi.mock('../../../store/useToastStore', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useToastStore: (selector: any) => selector({
        showToast: vi.fn()
    })
}));
vi.mock('../../../lib/tts/AudioPlayerService', () => ({
    AudioPlayerService: {
        getInstance: () => ({
            setBookId: vi.fn(),
            getQueue: vi.fn(),
            jumpTo: vi.fn(),
            skipToNextSection: vi.fn(),
            skipToPreviousSection: vi.fn()
        })
    }
}));
vi.mock('../../../hooks/useTTS', () => ({
    useTTS: vi.fn()
}));
vi.mock('../../../hooks/useSmartTOC', () => ({
    useSmartTOC: () => ({
        enhanceTOC: vi.fn(),
        isEnhancing: false,
        progress: null
    })
}));
vi.mock('../../../hooks/useSidebarState', () => ({
    useSidebarState: () => ({
        activeSidebar: 'none',
        setSidebar: vi.fn()
    })
}));

// Mock Child Components
vi.mock('../ReaderTTSController', () => ({ ReaderTTSController: () => null }));
vi.mock('../UnifiedInputController', () => ({ UnifiedInputController: () => null }));
vi.mock('../UnifiedAudioPanel', () => ({ UnifiedAudioPanel: () => null }));
vi.mock('../AnnotationList', () => ({ AnnotationList: () => null }));
vi.mock('../LexiconManager', () => ({ LexiconManager: () => null }));
vi.mock('../VisualSettings', () => ({ VisualSettings: () => null }));
vi.mock('../ReadingHistoryPanel', () => ({ ReadingHistoryPanel: () => null }));
vi.mock('../ContentAnalysisLegend', () => ({ ContentAnalysisLegend: () => null }));

describe('ReaderView Version Check', () => {
    const mockNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useNavigate as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockNavigate);
    });

    it('redirects to library if book version is outdated', async () => {
        // Mock outdated book metadata
        (useEpubReader as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            book: {},
            rendition: {
                hooks: { content: { register: vi.fn() } },
                on: vi.fn(),
                locations: { cfiFromPercentage: vi.fn() }
            },
            isReady: true,
            areLocationsReady: true,
            isLoading: false,
            metadata: {
                id: 'book-123',
                title: 'Outdated Book',
                version: CURRENT_BOOK_VERSION - 1 // Simulating older version
            },
            toc: [],
            error: null
        });

        render(
            <MemoryRouter>
                <ReaderView />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/', {
                state: { reprocessBookId: 'book-123' }
            });
        });
    });

    it('does not redirect if book version is current', async () => {
        // Mock current book metadata
        (useEpubReader as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            book: {},
            rendition: {
                hooks: { content: { register: vi.fn() } },
                on: vi.fn(),
                locations: { cfiFromPercentage: vi.fn() }
            },
            isReady: true,
            areLocationsReady: true,
            isLoading: false,
            metadata: {
                id: 'book-123',
                title: 'Current Book',
                version: CURRENT_BOOK_VERSION
            },
            toc: [],
            error: null
        });

        render(
            <MemoryRouter>
                <ReaderView />
            </MemoryRouter>
        );

        await waitFor(() => {
            // Should not be called with redirect to root
            expect(mockNavigate).not.toHaveBeenCalledWith('/', expect.anything());
        }, { timeout: 1000 }); // Wait a bit to ensure no effect fires
    });

    it('defaults to version 0 and redirects if version is missing', async () => {
        // Mock missing version
        (useEpubReader as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            book: {},
            rendition: {
                hooks: { content: { register: vi.fn() } },
                on: vi.fn(),
                locations: { cfiFromPercentage: vi.fn() }
            },
            isReady: true,
            areLocationsReady: true,
            isLoading: false,
            metadata: {
                id: 'book-123',
                title: 'Legacy Book'
                // version is undefined
            },
            toc: [],
            error: null
        });

        render(
            <MemoryRouter>
                <ReaderView />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/', {
                state: { reprocessBookId: 'book-123' }
            });
        });
    });
});
