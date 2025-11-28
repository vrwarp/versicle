import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TTSVoice } from '../lib/tts/providers/types';
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';
import type { TTSStatus } from '../lib/tts/AudioPlayerService';
import { GoogleTTSProvider } from '../lib/tts/providers/GoogleTTSProvider';
import { OpenAIProvider } from '../lib/tts/providers/OpenAIProvider';
import { WebSpeechProvider } from '../lib/tts/providers/WebSpeechProvider';

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

  /** Provider configuration */
  providerId: 'local' | 'google' | 'openai';
  apiKeys: {
      google: string;
      openai: string;
  };

  /** Actions */
  play: () => void;
  pause: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVoice: (voice: TTSVoice | null) => void;
  setProviderId: (id: 'local' | 'google' | 'openai') => void;
  setApiKey: (provider: 'google' | 'openai', key: string) => void;
  loadVoices: () => Promise<void>;

  /**
   * Internal sync method called by AudioPlayerService
   * @internal
   */
  syncState: (status: TTSStatus, activeCfi: string | null) => void;
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
        player.subscribe((status, activeCfi) => {
            set({
                status,
                isPlaying: status === 'playing',
                activeCfi
            });
        });

        return {
            isPlaying: false,
            status: 'stopped',
            rate: 1.0,
            pitch: 1.0,
            voice: null,
            voices: [],
            activeCfi: null,
            providerId: 'local',
            apiKeys: {
                google: '',
                openai: ''
            },

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
                } else {
                    newProvider = new WebSpeechProvider();
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
            loadVoices: async () => {
                // Ensure provider is set on player (in case of fresh load)
                const { providerId, apiKeys } = get();
                // We might need to check if player already has correct provider type
                // But simplified: just set it.
                 let newProvider;
                if (providerId === 'google') {
                    newProvider = new GoogleTTSProvider(apiKeys.google);
                } else if (providerId === 'openai') {
                    newProvider = new OpenAIProvider(apiKeys.openai);
                } else {
                    newProvider = new WebSpeechProvider();
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

            syncState: (status, activeCfi) => set({
                status,
                isPlaying: status === 'playing',
                activeCfi
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
        }),
    }
  )
);
