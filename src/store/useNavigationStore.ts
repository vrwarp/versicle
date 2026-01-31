import { create } from 'zustand';

/**
 * Priority levels for navigation handlers (Back button & Browser Navigation).
 * Use these constants when registering a handler to ensure correct precedence.
 */
export enum NavigationPriority {
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
 * Store for managing unified navigation interception (Android Back Button + Browser Navigation).
 *
 * This store allows components to register priority-based handlers to intercept "back" actions.
 * This applies to:
 * 1. Android Hardware Back Button (via Capacitor)
 * 2. Browser Back Button (via React Router Blocker)
 *
 * Handlers are executed in descending order of priority (highest priority first).
 * If a handler exists, it is executed and the navigation event is consumed (blocked).
 * If no handlers exist, the default behavior (navigation or app exit) proceeds.
 */
export type NavigationHandler = () => Promise<void> | void;

export interface NavigationState {
    handlers: { id: string; handler: NavigationHandler; priority: number }[];
    registerHandler: (id: string, handler: NavigationHandler, priority: number) => void;
    unregisterHandler: (id: string) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
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
