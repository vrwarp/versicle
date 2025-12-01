import { create } from 'zustand';

/**
 * Interface defining the state of the cost tracking store.
 */
interface CostState {
  /** The total number of characters processed in the current session. */
  sessionCharacters: number;
  /** Adds usage count to the session total. */
  addUsage: (count: number) => void;
  /** Resets the session usage counter. */
  resetSession: () => void;
}

/**
 * Zustand store to track session-based character usage for cost estimation.
 */
export const useCostStore = create<CostState>((set) => ({
  sessionCharacters: 0,
  addUsage: (count) => set((state) => ({ sessionCharacters: state.sessionCharacters + count })),
  resetSession: () => set({ sessionCharacters: 0 }),
}));

/**
 * Singleton class for estimating TTS costs and tracking usage.
 */
export class CostEstimator {
  private static instance: CostEstimator;

  private constructor() {}

  /**
   * Retrieves the singleton instance of the CostEstimator.
   *
   * @returns The singleton instance.
   */
  public static getInstance(): CostEstimator {
    if (!CostEstimator.instance) {
      CostEstimator.instance = new CostEstimator();
    }
    return CostEstimator.instance;
  }

  /**
   * Tracks the character usage for a given text.
   * Updates the global cost store.
   *
   * @param text - The text that was processed.
   */
  public track(text: string): void {
    const count = text.length;
    useCostStore.getState().addUsage(count);
  }

  /**
   * Gets the total character usage for the current session.
   *
   * @returns The number of characters processed.
   */
  public getSessionUsage(): number {
    return useCostStore.getState().sessionCharacters;
  }

  /**
   * Estimates the cost of synthesizing text with a specific provider.
   *
   * @param text - The text to be synthesized.
   * @param provider - The TTS provider ('google' or 'openai').
   * @returns The estimated cost in USD.
   */
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
