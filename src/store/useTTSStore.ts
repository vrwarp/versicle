import { create } from 'zustand';

/**
 * State interface for the Text-to-Speech (TTS) store.
 */
interface TTSState {
  /** Flag indicating if TTS is currently playing. */
  isPlaying: boolean;
  /** Speech rate (speed). Default is 1.0. */
  rate: number;
  /** Speech pitch. Default is 1.0. */
  pitch: number;
  /** The selected voice for speech synthesis. */
  voice: SpeechSynthesisVoice | null;
  /** The CFI of the currently spoken sentence or segment. */
  activeCfi: string | null;

  /** Sets the playing state directly. */
  setPlaying: (isPlaying: boolean) => void;
  /** Starts playback. */
  play: () => void;
  /** Pauses playback. */
  pause: () => void;
  /** Stops playback and clears the active CFI. */
  stop: () => void;
  /** Sets the speech rate. */
  setRate: (rate: number) => void;
  /** Sets the speech pitch. */
  setPitch: (pitch: number) => void;
  /** Sets the speech voice. */
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
  /** Sets the active CFI to highlight the text being spoken. */
  setActiveCfi: (cfi: string | null) => void;
}

/**
 * Zustand store for managing Text-to-Speech configuration and playback state.
 */
export const useTTSStore = create<TTSState>((set) => ({
  isPlaying: false,
  rate: 1.0,
  pitch: 1.0,
  voice: null,
  activeCfi: null,
  setPlaying: (isPlaying) => set({ isPlaying }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, activeCfi: null }),
  setRate: (rate) => set({ rate }),
  setPitch: (pitch) => set({ pitch }),
  setVoice: (voice) => set({ voice }),
  setActiveCfi: (activeCfi) => set({ activeCfi }),
}));
