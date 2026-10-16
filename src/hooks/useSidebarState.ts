import { useCallback, useEffect } from 'react';
import { useNavigationGuard } from './useNavigationGuard';
import { BackButtonPriority } from '@store/useBackNavigationStore';
import { useSidebarStore, type SidebarType } from '@store/useSidebarStore';

export type { SidebarType };

export function useSidebarState() {
  const activeSidebar = useSidebarStore((s) => s.active);
  const setActive = useSidebarStore((s) => s.setActive);

  const setSidebar = useCallback((sidebar: SidebarType) => {
    setActive(sidebar);
  }, [setActive]);

  // Close any open panel when the reader (re)mounts, so a stale panel does not
  // linger in the module-level store across reader sessions.
  useEffect(() => {
    setActive('none');
  }, [setActive]);

  // "Back closes the open panel": while a panel is open, intercept the browser
  // and hardware Back button (via BackNavigationManager) and close the panel instead of
  // leaving the reader. When nothing is open the guard is disabled, so Back navigates
  // normally (back to the library).
  const closeOnBack = useCallback(() => {
    setActive('none');
  }, [setActive]);
  useNavigationGuard(closeOnBack, BackButtonPriority.UI_ELEMENT, activeSidebar !== 'none');

  return { activeSidebar, setSidebar };
}
