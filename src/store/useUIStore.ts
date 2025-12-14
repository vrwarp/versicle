import { create } from 'zustand';

/**
 * State interface for global UI state.
 */
interface UIState {
    /** Whether the global settings dialog is open. */
    isGlobalSettingsOpen: boolean;
    /** Sets the visibility of the global settings dialog. */
    setGlobalSettingsOpen: (open: boolean) => void;
}

/**
 * Zustand store for managing global UI state (modals, sidebars, etc.).
 */
export const useUIStore = create<UIState>((set) => ({
    isGlobalSettingsOpen: false,
    setGlobalSettingsOpen: (open) => set({ isGlobalSettingsOpen: open }),
}));
