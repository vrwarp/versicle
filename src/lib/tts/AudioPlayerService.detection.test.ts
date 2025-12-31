import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { genAIService } from '../genai/GenAIService';
import { dbService } from '../../db/DBService';
import { ContentType } from '../../types/content-analysis';

// Mock dependencies
// IMPORTANT: useTTSStore must be mocked with a factory to prevent side effects
// from the real module (which calls AudioPlayerService.getInstance() at top level).
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn()
  }
}));
import { useTTSStore } from '../../store/useTTSStore';

vi.mock('../../db/DBService');
vi.mock('../genai/GenAIService');
vi.mock('../epub-reader-context', () => ({
  useEpubReaderStore: {
    getState: () => ({
      rendition: {
        location: {
          start: { cfi: 'test-cfi' }
        }
      }
    })
  }
}));

// Mock window.speechSynthesis
Object.defineProperty(window, 'speechSynthesis', {
  value: {
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [],
  },
  writable: true
});

// Mock MediaSession
Object.defineProperty(navigator, 'mediaSession', {
  value: {
    metadata: null,
    setActionHandler: vi.fn(),
    setPositionState: vi.fn(),
    playbackState: 'none'
  },
  writable: true
});

describe('AudioPlayerService Content Detection', () => {
  let service: AudioPlayerService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock store state
    const mockStore = {
      settings: {
        voice: 'en-US',
        rate: 1.0,
        volume: 1.0,
        skipContentTypes: ['citation', 'table'] as ContentType[]
      },
      addLog: vi.fn()
    };
    (useTTSStore.getState as any).mockReturnValue(mockStore);

    // Mock DB Service
    (dbService.getContentAnalysis as any).mockResolvedValue(undefined);
    (dbService.saveContentClassifications as any).mockResolvedValue(undefined);
    (dbService.getSections as any).mockResolvedValue([
        { sectionId: 'sect1', playOrder: 1 }
    ]);

    service = AudioPlayerService.getInstance();

    // Manually set internal state for private method testing
    service.setBookId('book1');
    // We need to wait for playlist to resolve (it happens in setBookId promise)
    await new Promise(resolve => setTimeout(resolve, 0));

    // Force set currentSectionIndex (private)
    (service as any).currentSectionIndex = 0;
    // Force set playlist if it wasn't loaded correctly by mock
    (service as any).playlist = [{ sectionId: 'sect1' }];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips content detection if skipContentTypes is empty', async () => {
    // Setup empty skip list
    (useTTSStore.getState as any).mockReturnValue({
      settings: { skipContentTypes: [] },
      addLog: vi.fn()
    });

    const segments = [
      { cfi: 'cfi1', text: 'Text 1' }
    ];

    // Access private method for testing
    const result = await (service as any).detectAndFilterContent(segments, []);

    expect(genAIService.detectContentTypes).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].cfi).toBe('cfi1');
  });

  it('filters out detected content types', async () => {
    const segments = [
      { cfi: 'epubcfi(/6/2!/4/2/1:0)', text: 'Main content' },
      { cfi: 'epubcfi(/6/2!/4/4/1:0)', text: 'See Figure 1' } // Will be detected as citation
    ];

    // Mock detection result from GenAI
    (genAIService.detectContentTypes as any).mockResolvedValue([
      { rootCfi: 'epubcfi(/6/2!/4/2)', type: 'main' },
      { rootCfi: 'epubcfi(/6/2!/4/4)', type: 'citation' }
    ]);

    // Ensure DB returns nothing so it uses GenAI
    (dbService.getContentAnalysis as any).mockResolvedValue(undefined);

    // Enable GenAI usage check
    (genAIService.isConfigured as any).mockReturnValue(true);

    const result = await (service as any).detectAndFilterContent(segments, ['citation']);

    // Should only have 1 segment remaining (the main one)
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Main content');
    expect(genAIService.detectContentTypes).toHaveBeenCalled();
  });

  it('uses cached results from DB', async () => {
    const segments = [
      { cfi: 'epubcfi(/6/2!/4/2/1:0)', text: 'Cached content' }
    ];

    // Mock DB returning cached result
    (dbService.getContentAnalysis as any).mockResolvedValue({
      contentTypes: [
          { rootCfi: 'epubcfi(/6/2!/4/2)', type: 'citation' }
      ]
    });

    const result = await (service as any).detectAndFilterContent(segments, ['citation']);

    expect(result).toHaveLength(0);
    expect(genAIService.detectContentTypes).not.toHaveBeenCalled();
  });

  it('saves new detections to DB', async () => {
    const segments = [
      { cfi: 'epubcfi(/6/2!/4/2/1:0)', text: 'New content' }
    ];

    (genAIService.detectContentTypes as any).mockResolvedValue([
      { rootCfi: 'epubcfi(/6/2!/4/2)', type: 'main' }
    ]);

    (genAIService.isConfigured as any).mockReturnValue(true);

    await (service as any).detectAndFilterContent(segments, ['citation']);

    expect(dbService.saveContentClassifications).toHaveBeenCalledWith('book1', 'sect1', [
      { rootCfi: 'epubcfi(/6/2!/4/2)', type: 'main' }
    ]);
  });

  it('handles "other" type gracefully', async () => {
     const segments = [
      { cfi: 'epubcfi(/6/2!/4/2/1:0)', text: 'Other content' }
    ];

    (genAIService.detectContentTypes as any).mockResolvedValue([
      { rootCfi: 'epubcfi(/6/2!/4/2)', type: 'other' }
    ]);
    (genAIService.isConfigured as any).mockReturnValue(true);

    // "other" is not in skip list ['citation', 'table']
    const result = await (service as any).detectAndFilterContent(segments, ['citation', 'table']);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Other content');
  });
});
