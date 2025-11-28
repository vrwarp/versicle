import { create } from 'zustand';

interface CostState {
  sessionCharacters: number;
  addUsage: (count: number) => void;
  resetSession: () => void;
}

export const useCostStore = create<CostState>((set) => ({
  sessionCharacters: 0,
  addUsage: (count) => set((state) => ({ sessionCharacters: state.sessionCharacters + count })),
  resetSession: () => set({ sessionCharacters: 0 }),
}));

export class CostEstimator {
  private static instance: CostEstimator;

  private constructor() {}

  public static getInstance(): CostEstimator {
    if (!CostEstimator.instance) {
      CostEstimator.instance = new CostEstimator();
    }
    return CostEstimator.instance;
  }

  public track(text: string): void {
    const count = text.length;
    useCostStore.getState().addUsage(count);
  }

  public getSessionUsage(): number {
    return useCostStore.getState().sessionCharacters;
  }

  public estimateCost(text: string, provider: 'google' | 'openai'): number {
    // Rough estimates:
    // Google: $16.00 USD per 1 million characters (WaveNet) -> $0.000016 per char
    // OpenAI: $0.015 per 1,000 characters (tts-1) -> $0.000015 per char
    //        $0.030 per 1,000 characters (tts-1-hd) -> $0.000030 per char

    const length = text.length;
    if (provider === 'google') {
        return length * 0.000016;
    } else if (provider === 'openai') {
        return length * 0.000015; // Assume standard model for estimation
    }
    return 0;
  }
}
