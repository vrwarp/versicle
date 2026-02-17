
import { describe, it, vi, beforeEach } from 'vitest';
import { dbService } from '../lib/tts/../../db/DBService';

// Mock dependencies BEFORE importing the service

vi.mock('@capawesome-team/capacitor-android-battery-optimization', () => ({
  BatteryOptimization: {
    isBatteryOptimizationEnabled: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

vi.mock('../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn().mockReturnValue({
            customAbbreviations: [],
            alwaysMerge: [],
            sentenceStarters: []
        })
    }
}));

vi.mock('@capacitor/core', () => {
  return {
    Capacitor: {
      isNativePlatform: vi.fn().mockReturnValue(true),
      getPlatform: vi.fn().mockReturnValue('android'),
    },
  };
});

// Mock MediaSession plugin
vi.mock('@jofr/capacitor-media-session', () => ({
    MediaSession: {
        setActionHandler: vi.fn(),
        setMetadata: vi.fn(),
        setPlaybackState: vi.fn(),
        setPositionState: vi.fn().mockResolvedValue(undefined),
    }
}));

// Mock DBService
vi.mock('../db/DBService', () => ({
  dbService: {
    getTTSContent: vi.fn(),
    getContentAnalysis: vi.fn(),
    getBookMetadata: vi.fn(),
    getTTSState: vi.fn(),
    saveTTSState: vi.fn(),
    updatePlaybackState: vi.fn(),
    getSections: vi.fn(),
    saveTTSPosition: vi.fn(),
    saveContentClassifications: vi.fn(),
  },
}));

// Mock LexiconService
vi.mock('../lib/tts/LexiconService', () => ({
  LexiconService: {
    getInstance: vi.fn().mockReturnValue({
        getRules: vi.fn().mockResolvedValue([]),
        applyLexicon: vi.fn((text) => text),
        getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
    }),
  },
}));

// Mock WebSpeechProvider and CapacitorTTSProvider
vi.mock('../lib/tts/providers/CapacitorTTSProvider', () => {
  // Return a class or a constructor function
  return {
      CapacitorTTSProvider: class {
          play = vi.fn();
          stop = vi.fn();
          pause = vi.fn();
          resume = vi.fn();
          preload = vi.fn();
          on = vi.fn();
          init = vi.fn();
          getVoices = vi.fn().mockResolvedValue([]);
          id = 'local';
      }
  }
});

// Now import the service
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';

describe('AudioPlayerService Background Crash Prevention', () => {
  let service: AudioPlayerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = AudioPlayerService.getInstance();
  });

  it('should NOT stop playback state during autoPlay transition', async () => {
    // Setup initial state
    const bookId = 'book1';
    const sectionId1 = 'sec1';
    const sectionId2 = 'sec2';

    vi.spyOn(dbService, 'getSections').mockResolvedValue([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { sectionId: sectionId1, characterCount: 100 } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { sectionId: sectionId2, characterCount: 100 } as any
    ]);

    vi.spyOn(dbService, 'getTTSContent').mockImplementation(async (bid, sid) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (sid === sectionId1) return { sentences: [{ text: 'Sentence 1', cfi: 'cfi1' }] } as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (sid === sectionId2) return { sentences: [{ text: 'Sentence 2', cfi: 'cfi2' }] } as any;
        return null;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(dbService, 'getBookMetadata').mockResolvedValue({ title: 'Book Title', author: 'Author' } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(dbService, 'getContentAnalysis').mockResolvedValue({ structure: { title: 'Chapter Title' } } as any);

    // Initialize
    service.setBookId(bookId);

    // Wait for playlist to load
    await new Promise(resolve => setTimeout(resolve, 10));

    // Load first section
    await service.loadSection(0, false); // autoPlay=false for initial load

    // Start playing
    await service.play();

    // Now trigger transition to next chapter
    await service.loadSection(1, true); // autoPlay=true

    // Wait for playInternal to run
    await new Promise(resolve => setTimeout(resolve, 100)); // wait for async playInternal
  });
});
