import { create } from 'zustand';
import { canonicalizeChar } from '@domains/chinese/vocabulary/canonicalize';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';

/**
 * Replication declaration (aggregated by src/store/registry.ts).
 * Flipped to merge-defaults + scopedDiff in flip wave 1 (phase2-fork-surgery.md
 * §2.6 #2): single small map, low write rate. No hydration-fallback canaries
 * existed — the actions would already crash if hydration deleted
 * `knownCharacters`, so the flip is strictly risk-reducing.
 *
 * KEY FORMAT (CRDT v7, Phase 6 §7.5): `knownCharacters` keys are
 * SIMPLIFIED single characters — every action canonicalizes its input
 * (write-path layer of the CH-6 fix; the read paths canonicalize the
 * displayed char, and the v7 migration rewrote pre-existing docs).
 */
export const VOCABULARY_STORE_DEF: SyncedStoreDef<'knownCharacters'> = {
  name: 'vocabulary',
  syncedKeys: ['knownCharacters'],
  hydration: 'merge-defaults',
  scopedDiff: true,
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
        const key = canonicalizeChar(char);
        if (state.knownCharacters[key]) {
          const remaining = { ...state.knownCharacters };
          delete remaining[key];
          return { knownCharacters: remaining };
        } else {
          return {
            knownCharacters: {
              ...state.knownCharacters,
              [key]: Date.now()
            }
          };
        }
      }),

      markAsKnown: (char) => set((state) => ({
        knownCharacters: {
          ...state.knownCharacters,
          [canonicalizeChar(char)]: Date.now()
        }
      })),

      markAsUnknown: (char) => set((state) => {
        const remaining = { ...state.knownCharacters };
        delete remaining[canonicalizeChar(char)];
        return { knownCharacters: remaining };
      }),

      clearAll: () => set({ knownCharacters: {} })
    })
  )
);
