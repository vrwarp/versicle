import { useState, useEffect, useCallback, useRef } from 'react';

export type SidebarType = 'toc' | 'annotations' | 'search' | 'audio' | 'visual_settings' | null;

export function useSidebarManager() {
    const [activeSidebar, setActiveSidebarState] = useState<SidebarType>(null);
    const isHandlingHistory = useRef(false);

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const state = event.state as { sidebar?: SidebarType } | null;
            // When popstate fires, we sync the local state with the history state
            isHandlingHistory.current = true;
            setActiveSidebarState(state?.sidebar || null);
            isHandlingHistory.current = false;
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const setSidebar = useCallback((sidebar: SidebarType) => {
        setActiveSidebarState(current => {
            if (current === sidebar) return current;

            if (sidebar) {
                // Opening or Switching
                if (current) {
                    // Switching sidebars: Replace state to keep history stack clean
                    window.history.replaceState({ sidebar }, '');
                } else {
                    // Opening a new sidebar: Push state
                    window.history.pushState({ sidebar }, '');
                }
                return sidebar;
            } else {
                // Closing via UI
                if (current) {
                    // If we are currently open and closing via UI, we need to go back in history
                    // to remove the pushed state.
                    // However, we need to be careful not to create a loop if this was triggered by popstate.
                    if (!isHandlingHistory.current) {
                        window.history.back();
                        // We return current state for now and let the popstate listener update it to null.
                        // This ensures UI stays in sync with history.
                        // However, waiting for the event loop might feel laggy?
                        // Actually, history.back() is async but fast.
                        // If we return null immediately, we might have a race condition where popstate fires later.
                        // But usually popstate fires almost immediately.
                        // Let's rely on popstate for closing to be robust.
                        return current;
                    }
                }
                return null;
            }
        });
    }, []);

    // Helper to force close (e.g. on navigation away) without back?
    // Not needed if we rely on browser navigation.

    return { activeSidebar, setSidebar };
}
