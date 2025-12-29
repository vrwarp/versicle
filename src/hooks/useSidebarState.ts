import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';

export type SidebarType = 'none' | 'toc' | 'annotations' | 'search' | 'audio-panel' | 'visual-settings';

export function useSidebarState() {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive active sidebar from location state
  const activeSidebar: SidebarType = (location.state as { sidebar?: SidebarType })?.sidebar || 'none';

  // Clear sidebar state on mount (handle reload)
  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      if (activeSidebar !== 'none') {
        // Reset to none on initial load by replacing the current state
        // This ensures that refreshing the page closes any open panels
        navigate('.', { state: { ...location.state, sidebar: undefined }, replace: true });
      }
    }
  }, [activeSidebar, navigate, location.state]);

  const setSidebar = (sidebar: SidebarType) => {
    if (sidebar === activeSidebar) return;

    if (sidebar === 'none') {
      // Closing: Go back in history
      navigate(-1);
    } else {
      if (activeSidebar === 'none') {
        // Opening: Push new state
        navigate('.', { state: { ...location.state, sidebar }, replace: false });
      } else {
        // Switching: Replace current sidebar state
        navigate('.', { state: { ...location.state, sidebar }, replace: true });
      }
    }
  };

  return { activeSidebar, setSidebar };
}
