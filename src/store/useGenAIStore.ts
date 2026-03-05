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
  maxLogs: number;
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
  setMaxLogs: (max: number) => void;
  addLog: (log: GenAILogEntry) => void;
  clearLogs: () => void;
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
      contentFilterSkipTypes: ['reference'],
      isDebugModeEnabled: false,
      logs: [],
      maxLogs: 100,
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
      setMaxLogs: (max) => set({ maxLogs: max }),
      addLog: (log) =>
        set((state) => {
          const newLogs = [...state.logs, log];
          if (newLogs.length > state.maxLogs) {
            newLogs.splice(0, newLogs.length - state.maxLogs);
          }
          return { logs: newLogs };
        }),
      clearLogs: () => set({ logs: [] }),
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
      }),
      onRehydrateStorage: () => (state) => {
          state?.init();
      }
    }
  )
);
