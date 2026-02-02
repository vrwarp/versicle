import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

// Mock WebSpeechProvider class
vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      id = 'local';
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      play = vi.fn().mockResolvedValue(undefined);
      preload = vi.fn();
      stop = vi.fn();
      on = vi.fn();
      setConfig = vi.fn();
      pause = vi.fn();
      resume = vi.fn();
    }
  };
});

// Mock CapacitorTTSProvider class
vi.mock('./providers/CapacitorTTSProvider', () => {
    return {
        CapacitorTTSProvider: class {
            id = 'local';
            init = vi.fn().mockResolvedValue(undefined);
            getVoices = vi.fn().mockResolvedValue([]);
            play = vi.fn().mockResolvedValue(undefined);
            preload = vi.fn();
            stop = vi.fn();
            on = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
        }
    }
});

// Mock Dependencies
vi.mock('./SyncEngine');
vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn(() => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
            getRulesHash: vi.fn().mockResolvedValue('hash'),
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default')
        }))
    }
}));
vi.mock('./MediaSessionManager');
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({
        title: 'Test Book',
        author: 'Test Author',
        coverUrl: 'http://example.com/cover.jpg'
    }),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    saveTTSState: vi.fn(),
    updateReadingHistory: vi.fn().mockResolvedValue(undefined),
    getSections: vi.fn().mockResolvedValue([
        { sectionId: 'sec1', characterCount: 100 },
        { sectionId: 'sec2', characterCount: 0 },
        { sectionId: 'sec3', characterCount: 100 }
    ]),
    getContentAnalysis: vi.fn().mockResolvedValue({ structure: { title: 'Chapter 1' } }),
    getTTSContent: vi.fn().mockImplementation((bookId, sectionId) => {
        return Promise.resolve({
            sentences: [{ text: "Sentence " + sectionId, cfi: "cfi_" + sectionId }]
        });
    }),
    saveTTSPosition: vi.fn(),
    saveContentClassifications: vi.fn(),
    getTableImages: vi.fn().mockResolvedValue([]),
  }
}));
vi.mock('./CostEstimator');

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: vi.fn().mockReturnValue({
        customAbbreviations: [],
        alwaysMerge: [],
        sentenceStarters: [],
        minSentenceLength: 0,
        isBibleLexiconEnabled: false
    })
  }
}));

// Mock useGenAIStore
vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn().mockReturnValue({
            isContentAnalysisEnabled: false,
            isEnabled: false,
            contentFilterSkipTypes: [],
            apiKey: 'test-key'
        })
    }
}));

// Mock useReaderUIStore - THIS IS THE KEY MOCK
const { mockSetCurrentSection } = vi.hoisted(() => {
  return { mockSetCurrentSection: vi.fn() }
});

vi.mock('../../store/useReaderUIStore', () => ({
    useReaderUIStore: {
        getState: vi.fn().mockReturnValue({
            setCurrentSection: mockSetCurrentSection
        })
    }
}));


describe('AudioPlayerService - Reader Sync', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockSetCurrentSection.mockClear();

        // Reset singleton
        // @ts-expect-error Resetting singleton for testing
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
    });

    it('should update ReaderUIStore section title when loading a section', async () => {
        service.setBookId('book1');

        // Mock DB Service to return a specific title for this test
        vi.mocked(dbService.getContentAnalysis).mockResolvedValueOnce({
            // @ts-expect-error partial mock
            structure: { title: 'Chapter 1' }
        });

        // Load section 0 (sec1)
        await service.loadSection(0, false);

        // Wait for async tasks
        await new Promise(resolve => setTimeout(resolve, 0));

        // Verify setCurrentSection was called
        expect(mockSetCurrentSection).toHaveBeenCalledWith('Chapter 1', 'sec1');
    });

    it('should update ReaderUIStore section title when auto-advancing (simulated)', async () => {
         service.setBookId('book1');

        // Mock DB Service to return a specific title for this test
        vi.mocked(dbService.getContentAnalysis).mockResolvedValueOnce({
             // @ts-expect-error partial mock
            structure: { title: 'Chapter 2' }
        });

        // Directly call loadSectionInternal as public wrapper loadSection would do
        // But we want to test the title extraction logic inside loadSectionInternal

        // We'll use loadSection which queues loadSectionInternal
        // We target section 2 (sec3) which is index 2
        await service.loadSection(2, false);

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockSetCurrentSection).toHaveBeenCalledWith('Chapter 2', 'sec3');
    });

     it('should default to "Section X" if no title found', async () => {
         service.setBookId('book1');

        // Mock DB Service to return NO title
        vi.mocked(dbService.getContentAnalysis).mockResolvedValueOnce(null);

        // Load section 0 (sec1)
        await service.loadSection(0, false);

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockSetCurrentSection).toHaveBeenCalledWith('Section 1', 'sec1');
    });
});
