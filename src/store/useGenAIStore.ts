import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { genAIService } from '../lib/genai/GenAIService';
import type { GenAILogEntry } from '../lib/genai/GenAIService';

interface GenAIState {
  apiKey: string;
  model: string;
  isEnabled: boolean;
  logs: GenAILogEntry[];
  usageStats: {
    totalTokens: number;
    estimatedCost: number;
  };
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setEnabled: (enabled: boolean) => void;
  incrementUsage: (tokens: number) => void;
  addLog: (log: GenAILogEntry) => void;
  init: () => void;
}

export const useGenAIStore = create<GenAIState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      model: 'gemini-2.5-flash-lite',
      isEnabled: false,
      logs: [],
      usageStats: {
        totalTokens: 0,
        estimatedCost: 0,
      },
      setApiKey: (key) => {
        set({ apiKey: key });
        genAIService.configure(key, get().model);
      },
      setModel: (model) => {
        set({ model });
        genAIService.configure(get().apiKey, model);
      },
      setEnabled: (enabled) => set({ isEnabled: enabled }),
      incrementUsage: (tokens) =>
        set((state) => ({
          usageStats: {
            totalTokens: state.usageStats.totalTokens + tokens,
            estimatedCost: state.usageStats.estimatedCost,
          },
        })),
      addLog: (log) =>
        set((state) => {
          const newLogs = [...state.logs, log];
          if (newLogs.length > 10) {
            newLogs.shift();
          }
          return { logs: newLogs };
        }),
      init: () => {
          const { apiKey, model } = get();
          genAIService.configure(apiKey, model);
          genAIService.setLogCallback((log) => {
              get().addLog(log);
          });
      }
    }),
    {
      name: 'genai-storage',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
          state?.init();
      }
    }
  )
);
