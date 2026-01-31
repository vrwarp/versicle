import { create } from 'zustand';

export type BackButtonHandler = () => Promise<void> | void;

export interface BackButtonState {
    handlers: { id: string; handler: BackButtonHandler; priority: number }[];
    registerHandler: (id: string, handler: BackButtonHandler, priority: number) => void;
    unregisterHandler: (id: string) => void;
}

export const useBackButtonStore = create<BackButtonState>((set) => ({
    handlers: [],
    registerHandler: (id, handler, priority) =>
        set((state) => ({
            handlers: [...state.handlers, { id, handler, priority }].sort((a, b) => b.priority - a.priority),
        })),
    unregisterHandler: (id) =>
        set((state) => ({
            handlers: state.handlers.filter((h) => h.id !== id),
        })),
}));
