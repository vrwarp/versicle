import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { genAIService } from '../genai/GenAIService';
import { dbService } from '../../db/DBService';
import { TextSegmenter } from './TextSegmenter';
import { Capacitor } from '@capacitor/core';

// Mock dependencies
vi.mock('../../db/DBService', () => ({
  dbService: {
    getSections: vi.fn(),
    getTTSContent: vi.fn(),
    getBookMetadata: vi.fn(),
    getTTSState: vi.fn(),
    saveTTSPosition: vi.fn(),
    saveTTSState: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateReadingHistory: vi.fn(),
    getContentAnalysis: vi.fn(),
    saveContentClassifications: vi.fn(),
  }
}));
vi.mock('../genai/GenAIService');
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: vi.fn(),
  }
}));
vi.mock('../../store/useGenAIStore', () => ({
  useGenAIStore: {
    getState: vi.fn(),
  }
}));
vi.mock('./TextSegmenter');
vi.mock('./providers/WebSpeechProvider');
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn().mockReturnValue(false),
    getPlatform: vi.fn().mockReturnValue('web'),
  }
}));

describe('AudioPlayerService Content Detection', () => {
  let service: AudioPlayerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = AudioPlayerService.getInstance();
    // Clear the cache to ensure test isolation - NOTE: contentDetectionCache was removed in refactor
    // (service as any).contentDetectionCache?.clear();

    // Default mocks
    (useTTSStore.getState as any).mockReturnValue({
        customAbbreviations: [],
        alwaysMerge: [],
        sentenceStarters: [],
        skipContentTypes: ['citation'], // We want to test skipping
    });

    (useGenAIStore.getState as any).mockReturnValue({
        apiKey: 'test-key'
    });

    (genAIService.isConfigured as any).mockReturnValue(true);
    // Updated expectations: The fallback logic strips the last component (e.g., /1:0)
    // So epubcfi(/6/14[chapter1]!/4/2/1:0) -> parent is epubcfi(/6/14[chapter1]!/4/2)
    (genAIService.detectContentTypes as any).mockResolvedValue([
        { rootCfi: 'epubcfi(/6/14[chapter1]!/4/2)', type: 'main' },
        // getParentCfi logic for 'epubcfi(/6/14[chapter1]!/4/4/1:0)'
        // 1. parseCfiRange -> /6/14[chapter1]!/4/4/1:0
        // 2. wrapped -> epubcfi(/6/14[chapter1]!/4/4/1:0)
        // Wait, parseCfiRange returns what was passed if it parses as range (tuple).
        // But 'epubcfi(/6/14[chapter1]!/4/4/1:0)' is NOT a range (no commas).
        // So parseCfiRange returns null.
        // It goes to fallback block.
        // cleanParts: ['4', '4', '1:0'] -> pop -> ['4', '4'].
        // Result: epubcfi(/6/14[chapter1]!/4/4).
        { rootCfi: 'epubcfi(/6/14[chapter1]!/4/4)', type: 'citation' } // This one should be skipped
    ]);

    (dbService.getSections as any).mockResolvedValue([{ sectionId: 'sec1', characterCount: 100 }]);
    (dbService.getTTSContent as any).mockResolvedValue({
        sentences: [
            { text: 'Hello world.', cfi: 'epubcfi(/6/14[chapter1]!/4/2/1:0)' },
            { text: 'Reference 1.', cfi: 'epubcfi(/6/14[chapter1]!/4/4/1:0)' }
        ]
    });
    (dbService.getContentAnalysis as any).mockResolvedValue({
        structure: { title: 'Chapter 1' }
    }); // Default for title resolution, no contentTypes initially

    // Mock TextSegmenter to just return input
    (TextSegmenter.refineSegments as any).mockImplementation((s: any) => s);

    // Mock AudioPlayerService private/protected methods if needed via prototype or just assume loadSectionInternal is reachable via public loadSection
  });

  it('should skip sections marked as citation', async () => {
      // Setup
      service.setBookId('book-test-1');

      // Wait for playlist load
      await new Promise(resolve => setTimeout(resolve, 10));

      // Act
      await service.loadSection(0, false);

      // Wait longer and ensure the async tasks are processed
      // The issue is likely that enqueue() fires promises but they are resolved asynchronously.
      // loadSection() awaits enqueuing, but inside loadSectionInternal, the detect logic might be awaited,
      // but maybe the queue update happens slightly differently or there is a race condition in the test env.

      let updatedQueue = service.getQueue();
      let attempts = 0;
      while (updatedQueue.length !== 1 && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 200));
          updatedQueue = service.getQueue();
          attempts++;
      }

      // Debugging why filtering didn't happen
      if (updatedQueue.length === 2) {
          // If the service didn't call saving, it means it either found existing content or detection wasn't triggered
          // But in this test, DB returns undefined initially.
          // Is GenAI configured?
          const isConfigured = genAIService.isConfigured();
          console.log('GenAI Configured:', isConfigured);

          // Is skipContentTypes set?
          const settings = useTTSStore.getState();
          console.log('Skip Settings:', settings.skipContentTypes);
      }

      expect(updatedQueue).toHaveLength(1);
      expect(updatedQueue[0].text).toBe('Hello world.');

      // Verify GenAI called with correct groups
      expect(genAIService.detectContentTypes).toHaveBeenCalledWith([
          { rootCfi: 'epubcfi(/6/14[chapter1]!/4/2)', sampleText: 'Hello world. ' },
          { rootCfi: 'epubcfi(/6/14[chapter1]!/4/4)', sampleText: 'Reference 1. ' }
      ]);
      // Verify persistence
      expect(dbService.saveContentClassifications).toHaveBeenCalled();
  });

  it('should not skip if skipContentTypes is empty', async () => {
       (useTTSStore.getState as any).mockReturnValue({
        customAbbreviations: [],
        alwaysMerge: [],
        sentenceStarters: [],
        skipContentTypes: [], // Empty
       });

      // Setup
      service.setBookId('book-test-2');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Act
      await service.loadSection(0, false);

      // Assert
      const queue = service.getQueue();
      expect(queue).toHaveLength(2); // Both

      // GenAI might still be called if not cached, but filtering won't happen.
      // Actually optimization check `skipTypes.length > 0` prevents calling.
      expect(genAIService.detectContentTypes).not.toHaveBeenCalled();
  });

  it('should use persisted results on subsequent calls', async () => {
        service.setBookId('book-test-3');
        await new Promise(resolve => setTimeout(resolve, 10));

        // First call: No cache, calls GenAI
        await service.loadSection(0, false);

        // Wait for async processing
        let attempts = 0;
        while (genAIService.detectContentTypes.mock.calls.length === 0 && attempts < 10) {
             await new Promise(resolve => setTimeout(resolve, 100));
             attempts++;
        }

        expect(genAIService.detectContentTypes).toHaveBeenCalledTimes(1);
        expect(dbService.saveContentClassifications).toHaveBeenCalledTimes(1);

        // Second call: Mock DB returning result
        (genAIService.detectContentTypes as any).mockClear();
        (dbService.getContentAnalysis as any).mockResolvedValue({
            contentTypes: [
                { rootCfi: 'epubcfi(/6/14[chapter1]!/4/2)', type: 'main' },
                { rootCfi: 'epubcfi(/6/14[chapter1]!/4/4)', type: 'citation' }
            ]
        });

        await service.loadSection(0, false);

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(genAIService.detectContentTypes).not.toHaveBeenCalled();

        // Should still filter
        const queue = service.getQueue();
        expect(queue).toHaveLength(1);
  });
});
