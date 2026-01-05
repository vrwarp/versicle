import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { genAIService } from '../lib/genai/GenAIService';
import type { GenAILogEntry } from '../lib/genai/GenAIService';
import type { ContentType } from '../types/content-analysis';

interface GenAIState {
  apiKey: string;
  model: string;
  isEnabled: boolean;
  isModelRotationEnabled: boolean;
  isContentAnalysisEnabled: boolean;
  isTableAdaptationEnabled: boolean;
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
  setModelRotationEnabled: (enabled: boolean) => void;
  setContentAnalysisEnabled: (enabled: boolean) => void;
  setTableAdaptationEnabled: (enabled: boolean) => void;
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
      model: 'gemini-flash-lite-latest',
      isEnabled: false,
      isModelRotationEnabled: false,
      isContentAnalysisEnabled: false,
      isTableAdaptationEnabled: false,
      contentFilterSkipTypes: ['footnote', 'table'],
      isDebugModeEnabled: false,
      logs: [],
      usageStats: {
        totalTokens: 0,
        estimatedCost: 0,
      },
      setApiKey: (key) => {
        set({ apiKey: key });
        genAIService.configure(key, get().model, get().isModelRotationEnabled);
      },
      setModel: (model) => {
        set({ model });
        genAIService.configure(get().apiKey, model, get().isModelRotationEnabled);
      },
      setEnabled: (enabled) => set({ isEnabled: enabled }),
      setModelRotationEnabled: (enabled) => {
        set({ isModelRotationEnabled: enabled });
        genAIService.configure(get().apiKey, get().model, enabled);
      },
      setContentAnalysisEnabled: (enabled) => set({ isContentAnalysisEnabled: enabled }),
      setTableAdaptationEnabled: (enabled) => set({ isTableAdaptationEnabled: enabled }),
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
          const { apiKey, model, isModelRotationEnabled } = get();
          genAIService.configure(apiKey, model, isModelRotationEnabled);
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
