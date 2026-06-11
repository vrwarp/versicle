import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';

/** Replication declaration (aggregated by src/store/registry.ts). */
export const VOCABULARY_STORE_DEF: SyncedStoreDef<'knownCharacters'> = {
  name: 'vocabulary',
  syncedKeys: ['knownCharacters'],
  hydration: 'replace',
  scopedDiff: false,
};

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
  defineSyncedStore(
    VOCABULARY_STORE_DEF,
    (set) => ({
      knownCharacters: {},

      toggleKnownCharacter: (char) => set((state) => {
        if (state.knownCharacters[char]) {
          const remaining = { ...state.knownCharacters };
          delete remaining[char];
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
        const remaining = { ...state.knownCharacters };
        delete remaining[char];
        return { knownCharacters: remaining };
      }),

      clearAll: () => set({ knownCharacters: {} })
    })
  )
);
