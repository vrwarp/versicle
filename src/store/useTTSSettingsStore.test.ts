import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTTSSettingsStore, selectActiveRate, selectActiveVoiceId, selectActiveMinSentenceLength } from './useTTSSettingsStore';

// The persisted half of the 5b split (regression: useTTSStore — pure state
// transitions carried over; engine commands live on TtsController, the
// playback mirror in useTTSPlaybackStore).

describe('useTTSSettingsStore', () => {
  beforeEach(() => {
    useTTSSettingsStore.setState({
      activeLanguage: 'en',
      profiles: {
          en: { voiceId: null, rate: 1, minSentenceLength: 36 }
      },
      providerId: 'webspeech',
      apiKeys: { google: '', openai: '', lemonfox: '' },
    });
  });

  it('should have initial state', () => {
    const state = useTTSSettingsStore.getState();
    expect(selectActiveRate(state)).toBe(1);
    expect(selectActiveVoiceId(state)).toBeNull();
    expect(selectActiveMinSentenceLength(state)).toBe(36);
  });

  it('exposes no engine command or playback-mirror members (they moved in the split)', () => {
    const state = useTTSSettingsStore.getState() as unknown as Record<string, unknown>;
    for (const legacyMember of ['play', 'pause', 'stop', 'jumpTo', 'seek', 'loadVoices', 'downloadVoice', 'initialize', 'queue', 'status', 'isPlaying', 'voices', 'rate', 'pitch', 'voice', 'enableCostWarning']) {
      expect(state[legacyMember], `settings store must not own '${legacyMember}'`).toBeUndefined();
    }
  });

  it('setRate writes the active profile (selectors derive the active value)', () => {
    useTTSSettingsStore.getState().setRate(1.5);
    expect(useTTSSettingsStore.getState().profiles['en'].rate).toBe(1.5);
    expect(selectActiveRate(useTTSSettingsStore.getState())).toBe(1.5);
  });

  it('setRate(rate, lang) writes the TARGET profile without touching the active one', () => {
    useTTSSettingsStore.getState().setRate(2.0, 'zh');
    const state = useTTSSettingsStore.getState();
    expect(state.profiles['zh'].rate).toBe(2.0);
    expect(selectActiveRate(state)).toBe(1); // active (en) untouched
  });

  it('setVoiceId records the voice in the profile', () => {
    useTTSSettingsStore.getState().setVoiceId('test');
    expect(useTTSSettingsStore.getState().profiles['en'].voiceId).toBe('test');
    expect(selectActiveVoiceId(useTTSSettingsStore.getState())).toBe('test');
  });

  it('setActiveLanguage switches profiles (and creates a default when missing)', () => {
    useTTSSettingsStore.setState({
        profiles: {
            en: { voiceId: 'test-en', rate: 1.0, minSentenceLength: 36 },
            zh: { voiceId: 'test-zh', rate: 1.5, minSentenceLength: 6 }
        },
    });

    useTTSSettingsStore.getState().setActiveLanguage('zh');

    const state = useTTSSettingsStore.getState();
    expect(state.activeLanguage).toBe('zh');
    expect(selectActiveRate(state)).toBe(1.5);
    expect(selectActiveVoiceId(state)).toBe('test-zh');
    expect(selectActiveMinSentenceLength(state)).toBe(6);

    // Unknown language: a default profile materializes (zh default length 6).
    useTTSSettingsStore.getState().setActiveLanguage('fr');
    expect(useTTSSettingsStore.getState().profiles['fr']).toMatchObject({ voiceId: null, rate: 1.0 });
  });

  it('setActiveLanguage does NOT wipe a saved profile voiceId (voice-recall floor)', () => {
    useTTSSettingsStore.setState({
      profiles: { en: { voiceId: 'saved-voice-id', rate: 1, minSentenceLength: 36 } },
    });

    useTTSSettingsStore.getState().setActiveLanguage('en');

    expect(useTTSSettingsStore.getState().profiles['en'].voiceId).toBe('saved-voice-id');
  });

  it('setProviderId and setApiKey are pure writes (no engine chain)', () => {
    useTTSSettingsStore.getState().setProviderId('google');
    expect(useTTSSettingsStore.getState().providerId).toBe('google');

    useTTSSettingsStore.getState().setApiKey('google', 'key-123');
    expect(useTTSSettingsStore.getState().apiKeys.google).toBe('key-123');
  });

  it('segmentation and toggle setters are pure writes', () => {
    const s = useTTSSettingsStore.getState();
    s.setCustomAbbreviations(['Mr.']);
    s.setAlwaysMerge(['Mr.']);
    s.setSentenceStarters(['The']);
    s.setSanitizationEnabled(false);
    s.setBibleLexiconEnabled(false);
    s.setPrerollEnabled(true);
    s.setBackgroundAudioMode('off');
    s.setWhiteNoiseVolume(0.9);
    s.setMinSentenceLength(12);

    const after = useTTSSettingsStore.getState();
    expect(after.customAbbreviations).toEqual(['Mr.']);
    expect(after.alwaysMerge).toEqual(['Mr.']);
    expect(after.sentenceStarters).toEqual(['The']);
    expect(after.sanitizationEnabled).toBe(false);
    expect(after.isBibleLexiconEnabled).toBe(false);
    expect(after.prerollEnabled).toBe(true);
    expect(after.backgroundAudioMode).toBe('off');
    expect(after.whiteNoiseVolume).toBe(0.9);
    expect(after.profiles['en'].minSentenceLength).toBe(12);
  });

  it('does not leak engine calls on writes (no audio-player import exists)', () => {
    // Structural pin: the module graph of this store reaches no engine module.
    // (The eslint no-restricted-imports ban enforces it at lint time; this is
    // the runtime sanity check that writes complete synchronously.)
    const spy = vi.fn();
    const unsub = useTTSSettingsStore.subscribe(spy);
    useTTSSettingsStore.getState().setRate(1.25);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });
});
