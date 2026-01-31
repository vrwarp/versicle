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
 * Store for managing Android back button handlers.
 *
 * This store allows components to register priority-based handlers for the hardware back button.
 * Handlers are executed in descending order of priority (highest priority first).
 * If a handler exists, it is executed. If no handlers exist, the default behavior (navigation or app exit) is used.
 *
 * **Example Usage:**
 *
 * ```typescript
 * import { useAndroidBackButton } from '../hooks/useAndroidBackButton';
 * import { BackButtonPriority } from '../store/useAndroidBackButtonStore';
 *
 * // Inside a component (e.g., a Modal)
 * useAndroidBackButton(() => {
 *   // Close the modal instead of navigating back
 *   setIsOpen(false);
 * }, BackButtonPriority.MODAL, isOpen);
 * ```
 *
 * **Future Unification Note:**
 * To unify this with browser-based navigation (e.g., preventing the user from accidentally navigating back
 * when a modal is open in a web context), we would need to integrate `react-router-dom`'s `useBlocker` or `window.onpopstate`.
 *
 * Ideally, a shared `useNavigationGuard` hook would:
 * 1. Register with this store (for Android hardware button).
 * 2. Register a router blocker (for browser back button).
 * 3. Execute the same handler when either event occurs.
 *
 * This would ensure that both the hardware button and the browser UI back button trigger the same
 * "close modal" logic before actually navigating history.
 */
export type BackButtonHandler = () => Promise<void> | void;

export interface AndroidBackButtonState {
    handlers: { id: string; handler: BackButtonHandler; priority: number }[];
    registerHandler: (id: string, handler: BackButtonHandler, priority: number) => void;
    unregisterHandler: (id: string) => void;
}

export const useAndroidBackButtonStore = create<AndroidBackButtonState>((set) => ({
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
