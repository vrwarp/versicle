import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TTSVoice } from '../lib/tts/providers/types';
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';
import type { TTSStatus, TTSQueueItem } from '../lib/tts/AudioPlayerService';
import { GoogleTTSProvider } from '../lib/tts/providers/GoogleTTSProvider';
import { OpenAIProvider } from '../lib/tts/providers/OpenAIProvider';
import { LemonFoxProvider } from '../lib/tts/providers/LemonFoxProvider';
import { PiperProvider } from '../lib/tts/providers/PiperProvider';
import { WebSpeechProvider } from '../lib/tts/providers/WebSpeechProvider';
import { CapacitorTTSProvider } from '../lib/tts/providers/CapacitorTTSProvider';
import { DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from '../lib/tts/TextSegmenter';
import { Capacitor } from '@capacitor/core';

/**
 * State interface for the Text-to-Speech (TTS) store.
 */
interface TTSState {
  /** Flag indicating if TTS is currently playing. */
  isPlaying: boolean;
  /** Current status of playback. */
  status: TTSStatus;
  /** Speech rate (speed). Default is 1.0. */
  rate: number;
  /** Speech pitch. Default is 1.0. */
  pitch: number;
  /** The selected voice for speech synthesis. */
  voice: TTSVoice | null;
  /** List of available voices */
  voices: TTSVoice[];
  /** The CFI of the currently spoken sentence or segment. */
  activeCfi: string | null;
  /** Current index in the playback queue */
  currentIndex: number;
  /** The playback queue */
  queue: TTSQueueItem[];
  /** The last error message, if any */
  lastError: string | null;

  /** Download State (for Piper) */
  downloadProgress: number;
  downloadStatus: string | null;
  downloadingVoiceId: string | null;
  isDownloading: boolean;

  /** Provider configuration */
  providerId: 'local' | 'google' | 'openai' | 'lemonfox' | 'piper';
  apiKeys: {
      google: string;
      openai: string;
      lemonfox: string;
  };

  /** Custom abbreviations for sentence segmentation */
  customAbbreviations: string[];
  /** Words that should always trigger a merge (e.g. "Mr.") */
  alwaysMerge: string[];
  /** Words that indicate a new sentence start (preventing merge) */
  sentenceStarters: string[];

  /** Whether to show cost warning dialogs */
  enableCostWarning: boolean;

  /** Whether to enable chapter pre-roll announcements */
  prerollEnabled: boolean;

  /** Whether to enable text sanitization (remove URLs, page numbers, etc.) */
  sanitizationEnabled: boolean;

  /** Local Provider Settings */
  silentAudioType: 'silence' | 'white-noise';
  whiteNoiseVolume: number;

  /** Actions */
  setSilentAudioType: (type: 'silence' | 'white-noise') => void;
  setWhiteNoiseVolume: (volume: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVoice: (voice: TTSVoice | null) => void;
  setProviderId: (id: 'local' | 'google' | 'openai' | 'lemonfox' | 'piper') => void;
  setApiKey: (provider: 'google' | 'openai' | 'lemonfox', key: string) => void;
  setCustomAbbreviations: (abbrevs: string[]) => void;
  setAlwaysMerge: (words: string[]) => void;
  setSentenceStarters: (words: string[]) => void;
  setEnableCostWarning: (enable: boolean) => void;
  setPrerollEnabled: (enable: boolean) => void;
  setSanitizationEnabled: (enable: boolean) => void;
  loadVoices: () => Promise<void>;
  downloadVoice: (voiceId: string) => Promise<void>;
  deleteVoice: (voiceId: string) => Promise<void>;
  checkVoiceDownloaded: (voiceId: string) => Promise<boolean>;
  jumpTo: (index: number) => void;
  seek: (seconds: number) => void;
  clearError: () => void;

  /**
   * Internal sync method called by AudioPlayerService
   * @internal
   */
  syncState: (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: TTSQueueItem[], error: string | null) => void;
}

const player = AudioPlayerService.getInstance();

/**
 * Zustand store for managing Text-to-Speech configuration and playback state.
 */
export const useTTSStore = create<TTSState>()(
  persist(
    (set, get) => {
        // Init player with persisted settings if available
        // Note: actions in persist are available after hydration.
        // We might need to listen to onRehydrateStorage or similar if we want to sync strictly on load.
        // For now, lazy init in loadVoices or actions is okay.

        // Subscribe to player updates
        player.subscribe((status, activeCfi, currentIndex, queue, error, downloadInfo) => {
            set(() => ({
                status,
                // Treat 'loading' as playing to prevent UI flicker (play/pause button)
                // during transitions between sentences or while buffering.
                isPlaying: status === 'playing' || status === 'loading',
                activeCfi,
                currentIndex,
                queue,
                lastError: error,
                ...(downloadInfo ? {
                    downloadProgress: downloadInfo.percent,
                    downloadStatus: downloadInfo.status,
                    downloadingVoiceId: downloadInfo.voiceId,
                    isDownloading: downloadInfo.percent < 100
                } : {})
            }));

            // If fallback happened (provider mismatch), we should update our providerId state
            // But checking provider type from here is hard without exposing it on player.
            // For now, we rely on the error message or just UI notification.
            // Ideally, we'd update providerId to 'local' if fallback occurred.
            // We can infer this if needed, or expose current provider ID in listener.
            // But 'lastError' is enough for now.
        });

        return {
            isPlaying: false,
            status: 'stopped',
            rate: 1.0,
            pitch: 1.0,
            voice: null,
            voices: [],
            activeCfi: null,
            currentIndex: 0,
            queue: [],
            lastError: null,
            downloadProgress: 0,
            downloadStatus: null,
            downloadingVoiceId: null,
            isDownloading: false,
            providerId: 'local',
            apiKeys: {
                google: '',
                openai: '',
                lemonfox: ''
            },
            enableCostWarning: true,
            prerollEnabled: false,
            sanitizationEnabled: true,
            silentAudioType: 'silence',
            whiteNoiseVolume: 0.1,
            customAbbreviations: [
                'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
                'e.g.', 'i.e.'
            ],
            alwaysMerge: DEFAULT_ALWAYS_MERGE,
            sentenceStarters: DEFAULT_SENTENCE_STARTERS,

            play: () => {
                player.play();
            },
            pause: () => {
                player.pause();
            },
            stop: () => {
                player.stop();
            },
            setRate: (rate) => {
                player.setSpeed(rate);
                set({ rate });
            },
            setPitch: (pitch) => {
                set({ pitch });
            },
            setVoice: (voice) => {
                if (voice) {
                    player.setVoice(voice.id);
                }
                set({ voice });
            },
            setProviderId: (id) => {
                set({ providerId: id });
                // Re-init player provider
                const { apiKeys } = get();
                let newProvider;
                if (id === 'google') {
                    newProvider = new GoogleTTSProvider(apiKeys.google);
                } else if (id === 'openai') {
                    newProvider = new OpenAIProvider(apiKeys.openai);
                } else if (id === 'lemonfox') {
                    newProvider = new LemonFoxProvider(apiKeys.lemonfox);
                } else if (id === 'piper') {
                    newProvider = new PiperProvider();
                } else {
                    if (Capacitor.isNativePlatform()) {
                        newProvider = new CapacitorTTSProvider();
                    } else {
                        const { silentAudioType, whiteNoiseVolume } = get();
                        newProvider = new WebSpeechProvider({ silentAudioType, whiteNoiseVolume });
                    }
                }

                player.setProvider(newProvider);
                // Reload voices for new provider
                get().loadVoices();
            },
            setApiKey: (provider, key) => {
                set((state) => ({
                    apiKeys: { ...state.apiKeys, [provider]: key }
                }));
                // Update current provider if it matches
                const { providerId } = get();
                if (providerId === provider) {
                     // Force re-init of provider
                     get().setProviderId(providerId);
                }
            },
            setCustomAbbreviations: (abbrevs) => {
                set({ customAbbreviations: abbrevs });
            },
            setAlwaysMerge: (words) => {
                set({ alwaysMerge: words });
            },
            setSentenceStarters: (words) => {
                set({ sentenceStarters: words });
            },
            setEnableCostWarning: (enable) => {
                set({ enableCostWarning: enable });
            },
            setPrerollEnabled: (enable) => {
                set({ prerollEnabled: enable });
            },
            setSanitizationEnabled: (enable) => {
                set({ sanitizationEnabled: enable });
            },
            setSilentAudioType: (type) => {
                set({ silentAudioType: type });
                const { whiteNoiseVolume } = get();
                player.setLocalProviderConfig({ silentAudioType: type, whiteNoiseVolume });
            },
            setWhiteNoiseVolume: (volume) => {
                set({ whiteNoiseVolume: volume });
                const { silentAudioType } = get();
                player.setLocalProviderConfig({ silentAudioType, whiteNoiseVolume: volume });
            },
            loadVoices: async () => {
                // Ensure provider is set on player (in case of fresh load)
                const { providerId, apiKeys, silentAudioType, whiteNoiseVolume } = get();
                // We might need to check if player already has correct provider type
                // But simplified: just set it.
                 let newProvider;
                if (providerId === 'google') {
                    newProvider = new GoogleTTSProvider(apiKeys.google);
                } else if (providerId === 'openai') {
                    newProvider = new OpenAIProvider(apiKeys.openai);
                } else if (providerId === 'lemonfox') {
                    newProvider = new LemonFoxProvider(apiKeys.lemonfox);
                } else if (providerId === 'piper') {
                    newProvider = new PiperProvider();
                } else {
                    if (Capacitor.isNativePlatform()) {
                        newProvider = new CapacitorTTSProvider();
                    } else {
                        newProvider = new WebSpeechProvider({ silentAudioType, whiteNoiseVolume });
                    }
                }
                player.setProvider(newProvider);

                await player.init();
                const voices = await player.getVoices();
                set({ voices });

                // If current voice is not in new list, pick default
                const currentVoice = get().voice;
                const voiceExists = currentVoice && voices.find(v => v.id === currentVoice.id);

                if (!voiceExists && voices.length > 0) {
                    const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
                    player.setVoice(defaultVoice.id);
                    set({ voice: defaultVoice });
                } else if (currentVoice) {
                    // Re-set voice to ensure player knows about it
                    player.setVoice(currentVoice.id);
                }
            },
            downloadVoice: async (voiceId) => {
                try {
                    set({ isDownloading: true, downloadingVoiceId: voiceId, downloadStatus: 'Starting...' });
                    await player.downloadVoice(voiceId);
                    set({ isDownloading: false, downloadStatus: 'Ready', downloadProgress: 100 });
                } catch (e) {
                    set({ isDownloading: false, downloadStatus: 'Failed', lastError: e instanceof Error ? e.message : 'Download failed' });
                }
            },
            deleteVoice: async (voiceId) => {
                await player.deleteVoice(voiceId);
                set({ isDownloading: false, downloadProgress: 0, downloadStatus: 'Not Downloaded', downloadingVoiceId: null });
            },
            checkVoiceDownloaded: async (voiceId) => {
                 return await player.isVoiceDownloaded(voiceId);
            },
            jumpTo: (index) => {
                player.jumpTo(index);
            },
            seek: (seconds) => {
                player.seek(seconds);
            },
            clearError: () => {
                set({ lastError: null });
            },

            syncState: (status, activeCfi, currentIndex, queue, error) => set({
                status,
                isPlaying: status === 'playing' || status === 'loading',
                activeCfi,
                currentIndex,
                queue,
                lastError: error
            }),
        };
    },
    {
        name: 'tts-storage',
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
            rate: state.rate,
            pitch: state.pitch,
            voice: state.voice,
            providerId: state.providerId,
            apiKeys: state.apiKeys,
            customAbbreviations: state.customAbbreviations,
            alwaysMerge: state.alwaysMerge,
            sentenceStarters: state.sentenceStarters,
            enableCostWarning: state.enableCostWarning,
            prerollEnabled: state.prerollEnabled,
            sanitizationEnabled: state.sanitizationEnabled,
            silentAudioType: state.silentAudioType,
            whiteNoiseVolume: state.whiteNoiseVolume,
        }),
        onRehydrateStorage: () => (state) => {
            if (state) {
                player.setLocalProviderConfig({
                    silentAudioType: state.silentAudioType,
                    whiteNoiseVolume: state.whiteNoiseVolume
                });
            }
        },
    }
  )
);
