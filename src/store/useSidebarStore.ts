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
 * This is a plain store rather than React Router `location.state`. The previous design
 * encoded the open panel in the router history (open = push, close = `navigate(-1)`),
 * which on WebKit could update history *without* re-rendering ReaderView while TTS was
 * active — the TOC sidebar would then never paint (see the skipped
 * test_tts_cross_chapter / Navigation Guard journeys). A Zustand `set` reliably
 * re-renders subscribers via useSyncExternalStore, decoupled from the router.
 *
 * The "Back button closes the open panel" UX that the router approach gave for free is
 * preserved explicitly via a navigation guard in `useSidebarState`
 * (src/hooks/useSidebarState.ts), the hook through which components consume this store.
 */
export const useSidebarStore = create<SidebarUIState>((set) => ({
  active: 'none',
  setActive: (active) => set({ active }),
}));
