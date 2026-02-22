import { create } from 'zustand';

/**
 * State interface for global UI state.
 */
interface UIState {
    /** Whether the global settings dialog is open. */
    isGlobalSettingsOpen: boolean;
    /** Sets the visibility of the global settings dialog. */
    setGlobalSettingsOpen: (open: boolean) => void;
    /** Whether the app is locked due to an obsolete schema version. */
    obsoleteLock: boolean;
    /** Sets the obsolete lock state (non-dismissible safe mode). */
    setObsoleteLock: (lock: boolean) => void;
}

/**
 * Zustand store for managing global UI state (modals, sidebars, etc.).
 */
export const useUIStore = create<UIState>((set) => ({
    isGlobalSettingsOpen: false,
    setGlobalSettingsOpen: (open) => set({ isGlobalSettingsOpen: open }),
    obsoleteLock: false,
    setObsoleteLock: (lock) => set({ obsoleteLock: lock }),
}));

