import { create } from 'zustand';

/**
 * State interface for global UI state.
 *
 * Phase 8 §B: `isGlobalSettingsOpen` retired — the settings overlay is
 * route state (`/settings/:tab`, see src/app/settings/SettingsShell.tsx);
 * openers navigate instead of toggling a flag. This store is the shell-UI
 * store (currently: the obsolete-schema lock).
 */
interface UIState {
    /** Whether the app is locked due to an obsolete schema version. */
    obsoleteLock: boolean;
    /** Sets the obsolete lock state (non-dismissible safe mode). */
    setObsoleteLock: (lock: boolean) => void;
}

/**
 * Zustand store for managing global UI state (modals, sidebars, etc.).
 */
export const useUIStore = create<UIState>((set) => ({
    obsoleteLock: false,
    setObsoleteLock: (lock) => set({ obsoleteLock: lock }),
}));
