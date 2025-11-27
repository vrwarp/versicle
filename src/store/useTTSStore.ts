import { create } from 'zustand';
import { TTSVoice } from '../lib/tts/providers/types';
import { AudioPlayerService, TTSStatus } from '../lib/tts/AudioPlayerService';

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

  /** Actions */
  play: () => void;
  pause: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVoice: (voice: TTSVoice | null) => void;
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
export const useTTSStore = create<TTSState>((set, get) => {

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
        // Pitch not yet implemented in AudioPlayerService but we keep state
        set({ pitch });
    },
    setVoice: (voice) => {
        if (voice) {
            player.setVoice(voice.id);
        }
        set({ voice });
    },
    loadVoices: async () => {
        await player.init();
        const voices = await player.getVoices();
        set({ voices });
        // Set default voice if none selected?
        if (!get().voice && voices.length > 0) {
            // Try to find a good default (e.g., English)
            const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
            get().setVoice(defaultVoice);
        }
    },

    syncState: (status, activeCfi) => set({
        status,
        isPlaying: status === 'playing',
        activeCfi
    }),
  };
});
