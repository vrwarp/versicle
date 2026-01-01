import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { genAIService } from '../lib/genai/GenAIService';
import type { GenAILogEntry } from '../lib/genai/GenAIService';
import type { ContentType } from '../types/content-analysis';

interface GenAIState {
  apiKey: string;
  model: string;
  isEnabled: boolean;
  isContentAnalysisEnabled: boolean;
  contentFilterSkipTypes: ContentType[];
  isDebugModeEnabled: boolean;
  logs: GenAILogEntry[];
  usageStats: {
    totalTokens: number;
    estimatedCost: number;
  };
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setEnabled: (enabled: boolean) => void;
  setContentAnalysisEnabled: (enabled: boolean) => void;
  setContentFilterSkipTypes: (types: ContentType[]) => void;
  setDebugModeEnabled: (enabled: boolean) => void;
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
      isContentAnalysisEnabled: false,
      contentFilterSkipTypes: ['footnote', 'table'],
      isDebugModeEnabled: false,
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
      setContentAnalysisEnabled: (enabled) => set({ isContentAnalysisEnabled: enabled }),
      setContentFilterSkipTypes: (types) => set({ contentFilterSkipTypes: types }),
      setDebugModeEnabled: (enabled) => set({ isDebugModeEnabled: enabled }),
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
      partialize: (state) => ({
        ...state,
        // Don't persist logs for size
        logs: [],
      }),
      onRehydrateStorage: () => (state) => {
          state?.init();
      }
    }
  )
);
