import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc, getYjsOptions } from './yjs-provider';

export interface VocabularyState {
  // Key-value store of characters to preserve sync performance
  // Key: Chinese character (string)
  // Value: Timestamp added (number)
  knownCharacters: Record<string, number>;

  // Actions
  toggleKnownCharacter: (char: string) => void;
  markAsKnown: (char: string) => void;
  markAsUnknown: (char: string) => void;
  clearAll: () => void;
}

export const useVocabularyStore = create<VocabularyState>()(
  yjs(
    yDoc,
    'vocabulary',
    (set) => ({
      knownCharacters: {},

      toggleKnownCharacter: (char) => set((state) => {
        if (state.knownCharacters[char]) {
          const { [char]: _, ...remaining } = state.knownCharacters;
          return { knownCharacters: remaining };
        } else {
          return {
            knownCharacters: {
              ...state.knownCharacters,
              [char]: Date.now()
            }
          };
        }
      }),

      markAsKnown: (char) => set((state) => ({
        knownCharacters: {
          ...state.knownCharacters,
          [char]: Date.now()
        }
      })),

      markAsUnknown: (char) => set((state) => {
        const { [char]: _, ...remaining } = state.knownCharacters;
        return { knownCharacters: remaining };
      }),

      clearAll: () => set({ knownCharacters: {} })
    }),
    getYjsOptions()
  )
);
