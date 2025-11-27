import { create } from 'zustand';

interface TTSState {
  isPlaying: boolean;
  rate: number;
  voice: SpeechSynthesisVoice | null;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
  setVoice: (voice: SpeechSynthesisVoice | null) => void;
}

export const useTTSStore = create<TTSState>((set) => ({
  isPlaying: false,
  rate: 1.0,
  voice: null,
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false }),
  setRate: (rate) => set({ rate }),
  setVoice: (voice) => set({ voice }),
}));
