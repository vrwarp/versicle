import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Local preferences store state.
 *
 * These preferences are NOT synced across devices via Yjs.
 * They are persisted to localStorage.
 */
interface LocalPreferencesState {
    currentTheme: 'light' | 'dark' | 'sepia' | 'custom';
    customTheme: { bg: string; fg: string };

    setTheme: (theme: 'light' | 'dark' | 'sepia' | 'custom') => void;
    setCustomTheme: (theme: { bg: string; fg: string }) => void;
}

const defaultLocalPreferences = {
    currentTheme: 'light' as const,
    customTheme: { bg: '#ffffff', fg: '#000000' }
};

/**
 * Zustand store for local-only user preferences.
 * Persisted to localStorage via persist middleware.
 */
export const useLocalPreferencesStore = create<LocalPreferencesState>()(
    persist(
        (set) => ({
            ...defaultLocalPreferences,
            setTheme: (theme) => set({ currentTheme: theme }),
            setCustomTheme: (customTheme) => set({ customTheme }),
        }),
        {
            name: 'local-preferences',
        }
    )
);
