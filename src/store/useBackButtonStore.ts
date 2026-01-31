import { create } from 'zustand';

/**
 * Store for managing Android back button handlers.
 *
 * This store allows components to register priority-based handlers for the hardware back button.
 * Handlers are executed in descending order of priority (highest priority first).
 * If a handler exists, it is executed. If no handlers exist, the default behavior (navigation or app exit) is used.
 *
 * **Example Usage:**
 *
 * ```typescript
 * import { useBackButton } from '../hooks/useBackButton';
 *
 * // Inside a component (e.g., a Modal)
 * useBackButton(() => {
 *   // Close the modal instead of navigating back
 *   setIsOpen(false);
 * }, 100, isOpen); // Priority 100, enabled only when isOpen is true
 * ```
 */
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
