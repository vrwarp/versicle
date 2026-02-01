import { create } from 'zustand';

/**
 * Priority levels for Android back button handlers.
 * Use these constants when registering a handler to ensure correct precedence.
 */
export enum BackButtonPriority {
    /** Default application navigation behavior (lowest priority) */
    DEFAULT = 0,
    /** Standard UI elements (e.g., sidebars, minor interactions) */
    UI_ELEMENT = 25,
    /** Modals, Dialogs, Bottom Sheets */
    MODAL = 50,
    /** Full-screen overlays, Critical alerts */
    OVERLAY = 100,
    /** Critical system-level interruptions */
    CRITICAL = 200,
}

/**
 * Store for managing back navigation handlers (Hardware button & Browser Back).
 *
 * This store allows components to register priority-based handlers for back navigation.
 * Handlers are executed in descending order of priority (highest priority first).
 *
 * - **Hardware Back Button (Android):** Triggered via Capacitor App plugin.
 * - **Browser Back Button:** Triggered via React Router `useBlocker` or `popstate`.
 *
 * **Example Usage:**
 *
 * ```typescript
 * import { useNavigationGuard } from '../hooks/useNavigationGuard';
 * import { BackButtonPriority } from '../store/useBackNavigationStore';
 *
 * // Inside a component (e.g., a Modal)
 * useNavigationGuard(() => {
 *   // Close the modal instead of navigating back
 *   setIsOpen(false);
 * }, BackButtonPriority.MODAL, isOpen);
 * ```
 */
export type BackButtonHandler = () => Promise<void> | void;

export interface BackNavigationState {
    handlers: { id: string; handler: BackButtonHandler; priority: number }[];
    registerHandler: (id: string, handler: BackButtonHandler, priority: number) => void;
    unregisterHandler: (id: string) => void;
}

export const useBackNavigationStore = create<BackNavigationState>((set) => ({
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
