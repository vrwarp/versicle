import { create } from 'zustand';

export type SidebarType = 'none' | 'toc' | 'annotations' | 'search' | 'audio-panel' | 'visual-settings';

interface SidebarUIState {
  active: SidebarType;
  setActive: (sidebar: SidebarType) => void;
}

/**
 * Which reader side panel (TOC / search / annotations / audio deck / visual settings)
 * is currently open. Ephemeral tier (see src/store/registry.ts).
 *
 * This is a plain store rather than React Router `location.state`. Encoding the open panel
 * in the router history (open = push, close = `navigate(-1)`) is unreliable: on WebKit it
 * could update history *without* re-rendering ReaderView while TTS was active — the TOC
 * sidebar would then never paint. A Zustand `set` reliably re-renders subscribers via
 * useSyncExternalStore, decoupled from the router.
 *
 * The "Back button closes the open panel" UX that the router approach would give for free
 * is provided explicitly via a navigation guard in `useSidebarState`
 * (src/hooks/useSidebarState.ts), the hook through which components consume this store.
 */
export const useSidebarStore = create<SidebarUIState>((set) => ({
  active: 'none',
  setActive: (active) => set({ active }),
}));
