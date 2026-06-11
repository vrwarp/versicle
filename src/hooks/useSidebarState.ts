import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { useNavigationGuard } from './useNavigationGuard';
import { BackButtonPriority } from '@store/useBackNavigationStore';

export type SidebarType = 'none' | 'toc' | 'annotations' | 'search' | 'audio-panel' | 'visual-settings';

interface SidebarUIState {
  active: SidebarType;
  setActive: (sidebar: SidebarType) => void;
}

/**
 * Which reader side panel (TOC / search / annotations / audio deck / visual settings)
 * is currently open.
 *
 * This is a plain store rather than React Router `location.state`. The previous design
 * encoded the open panel in the router history (open = push, close = `navigate(-1)`),
 * which on WebKit could update history *without* re-rendering ReaderView while TTS was
 * active — the TOC sidebar would then never paint (see the skipped
 * test_tts_cross_chapter / Navigation Guard journeys). A Zustand `set` reliably
 * re-renders subscribers via useSyncExternalStore, decoupled from the router.
 *
 * The "Back button closes the open panel" UX that the router approach gave for free is
 * preserved explicitly via a navigation guard in {@link useSidebarState}.
 */
const useSidebarStore = create<SidebarUIState>((set) => ({
  active: 'none',
  setActive: (active) => set({ active }),
}));

export function useSidebarState() {
  const activeSidebar = useSidebarStore((s) => s.active);
  const setActive = useSidebarStore((s) => s.setActive);

  const setSidebar = useCallback((sidebar: SidebarType) => {
    setActive(sidebar);
  }, [setActive]);

  // Close any open panel when the reader (re)mounts. Matches the previous behavior
  // where a reload/navigation cleared open panels, and prevents a stale panel from
  // lingering in the module-level store across reader sessions.
  useEffect(() => {
    setActive('none');
  }, [setActive]);

  // Preserve "Back closes the open panel": while a panel is open, intercept the browser
  // and hardware Back button (via BackNavigationManager) and close the panel instead of
  // leaving the reader. When nothing is open the guard is disabled, so Back navigates
  // normally (back to the library).
  const closeOnBack = useCallback(() => {
    setActive('none');
  }, [setActive]);
  useNavigationGuard(closeOnBack, BackButtonPriority.UI_ELEMENT, activeSidebar !== 'none');

  return { activeSidebar, setSidebar };
}
