import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { useContentAnalysisStore, SectionAnalysis } from '../../store/useContentAnalysisStore';
import { dbService } from '../../db/DBService';
import { useGenAIStore } from '../../store/useGenAIStore';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getSections: vi.fn(),
        getTTSState: vi.fn(),
        getBookMetadata: vi.fn(),
        getTTSContent: vi.fn(),
    }
}));

vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn(),
        subscribe: vi.fn(),
    }
}));

vi.mock('../../store/useContentAnalysisStore', () => {
    let state = { sections: {} as Record<string, SectionAnalysis> };
    const listeners: ((s: typeof state) => void)[] = [];

    return {
        useContentAnalysisStore: {
            getState: () => state,
            setState: (newState: typeof state) => {
                state = newState;
                listeners.forEach(l => l(state));
            },
            subscribe: (listener: (s: typeof state) => void) => {
                listeners.push(listener);
                return () => {
                    const idx = listeners.indexOf(listener);
                    if (idx > -1) listeners.splice(idx, 1);
                };
            },
            getAnalysis: vi.fn(),
        }
    };
});

describe('AudioPlayerService Content Analysis Race Condition', () => {
    let service: AudioPlayerService;
    let mockDetectContentSkipMask: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset stores to default state
        useContentAnalysisStore.setState({ sections: {} });

        // Mock gen AI store to enable analysis features
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useGenAIStore.getState as any).mockReturnValue({
            isEnabled: true,
            isContentAnalysisEnabled: true,
            contentFilterSkipTypes: ['reference'],
            isTableAdaptationEnabled: false,
        });

        // Set up dbService mocks to return valid data to pass early returns in handleContentAnalysisUpdate
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getSections as any).mockResolvedValue([{ sectionId: 'section1', href: 'section1.html' }]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSState as any).mockResolvedValue({ queue: [] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBookMetadata as any).mockResolvedValue({ id: 'book1' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSContent as any).mockResolvedValue({ sentences: [] });

        // Get instance
        service = AudioPlayerService.getInstance();

        // Use reflection to mock the contentPipeline's detectContentSkipMask
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pipeline = (service as any).contentPipeline;
        mockDetectContentSkipMask = vi.fn().mockResolvedValue(new Set());
        pipeline.detectContentSkipMask = mockDetectContentSkipMask;
    });

    it('prevents multiple redundant tasks from being enqueued when state updates rapidly', async () => {
        // Set up the service with a book and play queue so it is ready to process analysis
        await service.setBookId('book1');

        // Wait for playlist promise to resolve and set stateManager's playlist
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).playlistPromise;

        // Mock current section state so it passes the early exit validation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Object.defineProperty((service as any).stateManager, 'currentSectionIndex', {
            get: () => 0
        });

        const timestamp = Date.now();
        const stateWithAnalysis = {
            sections: {
                'book1/section1': {
                    status: 'success' as const,
                    generatedAt: timestamp,
                }
            }
        };

        // Fire the state update multiple times very rapidly (simulating React's batching or rapid network events)
        useContentAnalysisStore.setState(stateWithAnalysis);
        useContentAnalysisStore.setState(stateWithAnalysis);
        useContentAnalysisStore.setState(stateWithAnalysis);

        // Wait for all internal task sequencer operations to clear
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (service as any).taskSequencer.enqueue(async () => {});
        // Then wait for microtasks
        await new Promise(resolve => setTimeout(resolve, 0));

        // It should only have called the background skip mask detection ONE time
        // because the synchronous `lastAppliedAnalysisTimestamp` update caught the duplicates
        expect(mockDetectContentSkipMask).toHaveBeenCalledTimes(1);
    });
});