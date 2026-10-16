import { create } from 'zustand';

/**
 * State interface for global UI state.
 *
 * The settings overlay is route state (`/settings/:tab`, see
 * src/app/settings/SettingsShell.tsx), not a flag here; openers navigate. This
 * store is the shell-UI store (currently: the obsolete-schema lock).
 */
interface UIState {
    /** Whether the app is locked due to an obsolete schema version. */
    obsoleteLock: boolean;
    /** Sets the obsolete lock state (non-dismissible safe mode). */
    setObsoleteLock: (lock: boolean) => void;
}

/**
 * Zustand store for global shell UI state.
 */
export const useUIStore = create<UIState>((set) => ({
    obsoleteLock: false,
    setObsoleteLock: (lock) => set({ obsoleteLock: lock }),
}));
