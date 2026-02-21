import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc, getYjsOptions } from './yjs-provider';
import type { LexiconRule } from '../types/db';
import { v4 as uuidv4 } from 'uuid';

export interface LexiconState {
    // === SYNCED STATE (Yjs Map 'lexicon') ===

    /** 
     * Flat map of all rules.
     * Key: UUID (string)
     * Value: LexiconRule
     */
    rules: Record<string, LexiconRule>;

    /**
     * Per-book configuration.
     * Key: bookId (string)
     * Value: Configuration object
     */
    settings: Record<string, {
        bibleLexiconEnabled: 'on' | 'off' | 'default';
    }>;

    // === ACTIONS ===
    addRule: (rule: Omit<LexiconRule, 'id' | 'created' | 'order'>) => void;
    updateRule: (id: string, updates: Partial<LexiconRule>) => void;
    deleteRule: (id: string) => void;
    reorderRules: (updates: { id: string; order: number }[]) => void;
    setBiblePreference: (bookId: string, value: 'on' | 'off' | 'default') => void;
}

export const useLexiconStore = create<LexiconState>()(
    yjs(
        yDoc,
        'lexicon',
        (set) => ({
            rules: {},
            settings: {},

            addRule: (rule) => set((state) => {
                const id = uuidv4();
                // Determine order: max(existing) + 1
                const maxOrder = Object.values(state.rules).reduce((max, r) => (r.order || 0) > max ? (r.order || 0) : max, -1);

                const newRule: LexiconRule = {
                    ...rule,
                    id,
                    created: Date.now(),
                    order: maxOrder + 1
                };

                return {
                    rules: {
                        ...state.rules,
                        [id]: newRule
                    }
                };
            }),

            updateRule: (id, updates) => set((state) => {
                if (!state.rules[id]) return state;
                return {
                    rules: {
                        ...state.rules,
                        [id]: { ...state.rules[id], ...updates }
                    }
                };
            }),

            deleteRule: (id) => set((state) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [id]: removed, ...remainingRules } = state.rules;
                return { rules: remainingRules };
            }),

            reorderRules: (updates) => set((state) => {
                const newRules = { ...state.rules };
                let changed = false;

                updates.forEach(({ id, order }) => {
                    if (newRules[id] && newRules[id].order !== order) {
                        newRules[id] = { ...newRules[id], order };
                        changed = true;
                    }
                });

                if (!changed) return state;
                return { rules: newRules };
            }),

            setBiblePreference: (bookId, value) => set((state) => ({
                settings: {
                    ...state.settings,
                    [bookId]: {
                        ...state.settings[bookId],
                        bibleLexiconEnabled: value
                    }
                }
            }))
        }),
        getYjsOptions()
    )
);
