import { create } from 'zustand';

interface UIState {
    isGlobalSettingsOpen: boolean;
    setGlobalSettingsOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
    isGlobalSettingsOpen: false,
    setGlobalSettingsOpen: (open) => set({ isGlobalSettingsOpen: open }),
}));
