
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { Capacitor } from '@capacitor/core';
import { dbService } from '../lib/tts/../../db/DBService';
import { LexiconService } from '../lib/tts/LexiconService';

// Mock dependencies BEFORE importing the service
vi.mock('@capawesome-team/capacitor-android-foreground-service', () => ({
  ForegroundService: {
    startForegroundService: vi.fn(),
    stopForegroundService: vi.fn(),
    createNotificationChannel: vi.fn(),
  },
}));

vi.mock('@capawesome-team/capacitor-android-battery-optimization', () => ({
  BatteryOptimization: {
    isBatteryOptimizationEnabled: vi.fn().mockResolvedValue({ enabled: false }),
  },
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
        setPositionState: vi.fn(),
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
    updateReadingHistory: vi.fn(),
    getSections: vi.fn(),
  },
}));

// Mock LexiconService
vi.mock('../lib/tts/LexiconService', () => ({
  LexiconService: {
    getInstance: vi.fn().mockReturnValue({
        getRules: vi.fn().mockResolvedValue([]),
        applyLexicon: vi.fn((text) => text),
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

  it('should NOT call stopForegroundService during autoPlay transition', async () => {
    // Setup initial state
    const bookId = 'book1';
    const sectionId1 = 'sec1';
    const sectionId2 = 'sec2';

    vi.spyOn(dbService, 'getSections').mockResolvedValue([
        { sectionId: sectionId1, characterCount: 100 } as any,
        { sectionId: sectionId2, characterCount: 100 } as any
    ]);

    vi.spyOn(dbService, 'getTTSContent').mockImplementation(async (bid, sid) => {
        if (sid === sectionId1) return { sentences: [{ text: 'Sentence 1', cfi: 'cfi1' }] } as any;
        if (sid === sectionId2) return { sentences: [{ text: 'Sentence 2', cfi: 'cfi2' }] } as any;
        return null;
    });

    vi.spyOn(dbService, 'getBookMetadata').mockResolvedValue({ title: 'Book Title', author: 'Author' } as any);
    vi.spyOn(dbService, 'getContentAnalysis').mockResolvedValue({ structure: { title: 'Chapter Title' } } as any);

    // Initialize
    service.setBookId(bookId);

    // Wait for playlist to load
    await new Promise(resolve => setTimeout(resolve, 10));

    // Load first section
    await service.loadSection(0, false); // autoPlay=false for initial load

    // Start playing
    await service.play();

    // Verify startForegroundService called
    expect(ForegroundService.startForegroundService).toHaveBeenCalled();

    // Clear mocks to track calls during transition
    (ForegroundService.startForegroundService as any).mockClear();
    (ForegroundService.stopForegroundService as any).mockClear();

    // Now trigger transition to next chapter
    await service.loadSection(1, true); // autoPlay=true

    // Check that stopForegroundService was NOT called
    expect(ForegroundService.stopForegroundService).not.toHaveBeenCalled();

    // Check that startForegroundService WAS called (update notification)
    // Wait for playInternal to run
    await new Promise(resolve => setTimeout(resolve, 100)); // wait for async playInternal

    expect(ForegroundService.startForegroundService).toHaveBeenCalled();
  });
});
