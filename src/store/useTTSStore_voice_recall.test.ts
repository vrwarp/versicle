import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTTSStore } from './useTTSStore';

// Mock AudioPlayerService
vi.mock('../lib/tts/AudioPlayerService', () => {
    return {
        AudioPlayerService: {
            getInstance: vi.fn(() => ({
                setSpeed: vi.fn(),
                setVoice: vi.fn(),
                setLanguage: vi.fn(),
                subscribe: vi.fn(),
            }))
        }
    };
});

describe('useTTSStore - Voice Recall Regression', () => {
  beforeEach(() => {
    // Reset the store to a state mimicking a rehydrated store with a saved voice
    // but before voices have been loaded from the provider.
    useTTSStore.setState({
      activeLanguage: 'en',
      profiles: {
          en: { voiceId: 'saved-voice-id', rate: 1, pitch: 1, volume: 1 }
      },
      voices: [], 
      voice: null,
    });
  });

  it('should NOT wipe the voiceId from profile if voices are not yet loaded when setActiveLanguage is called', () => {
    // This simulates AudioPlayerService calling setActiveLanguage when a book is loaded
    useTTSStore.getState().setActiveLanguage('en');

    const profile = useTTSStore.getState().profiles['en'];
    
    // We expect the 'saved-voice-id' to be preserved even if it's not "validated" 
    // against the (currently empty) voices list yet.
    expect(profile.voiceId).toBe('saved-voice-id');
  });

  it('should pick a default voice if the saved voiceId is not found in loaded voices', () => {
    useTTSStore.setState({
      activeLanguage: 'en',
      profiles: {
          en: { voiceId: 'non-existent-voice', rate: 1, pitch: 1, volume: 1 }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      voices: [{ id: 'default-en', name: 'Default English', lang: 'en-US', provider: 'local' } as any], 
      voice: null,
    });

    useTTSStore.getState().setActiveLanguage('en');

    const profile = useTTSStore.getState().profiles['en'];
    expect(profile.voiceId).toBe('default-en');
  });

  it('should keep the saved voiceId if it IS found in loaded voices', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const targetVoice = { id: 'saved-voice-id', name: 'Saved Voice', lang: 'en-US', provider: 'local' } as any;
    useTTSStore.setState({
      activeLanguage: 'en',
      profiles: {
          en: { voiceId: 'saved-voice-id', rate: 1, pitch: 1, volume: 1 }
      },
      voices: [targetVoice], 
      voice: null,
    });

    useTTSStore.getState().setActiveLanguage('en');

    const profile = useTTSStore.getState().profiles['en'];
    expect(profile.voiceId).toBe('saved-voice-id');
    expect(useTTSStore.getState().voice).toBe(targetVoice);
  });
});
