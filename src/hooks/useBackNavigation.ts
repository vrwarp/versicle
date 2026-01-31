import { useEffect, useId, useCallback } from 'react';
import { useNavigationStore, type NavigationHandler } from '../store/useNavigationStore';
import { useBlocker } from 'react-router-dom';

/**
 * Hook to register a back navigation handler (Android Back Button + Browser Navigation).
 *
 * When `enabled` is true:
 * 1. Registers a handler with `useNavigationStore` (for Android hardware button).
 * 2. Registers a React Router blocker (for browser back button).
 *
 * If a navigation attempt is detected (or back button pressed), the handler is executed.
 *
 * @param handler The function to execute when back is requested.
 * @param priority The priority of the handler (use NavigationPriority enum).
 * @param enabled Whether the handler should be active.
 */
export const useBackNavigation = (handler: NavigationHandler, priority: number, enabled: boolean = true) => {
    const id = useId();
    const register = useNavigationStore((state) => state.registerHandler);
    const unregister = useNavigationStore((state) => state.unregisterHandler);

    // 1. Store Registration (Hardware Button)
    useEffect(() => {
        if (enabled) {
            register(id, handler, priority);
        }
        return () => {
            unregister(id);
        };
    }, [id, handler, priority, enabled, register, unregister]);

    // 2. Browser Navigation Blocking
    // We block if enabled is true.
    const blocker = useBlocker(
        useCallback(
            ({ historyAction }) => {
                // Only block POP actions (Back/Forward), not PUSH/REPLACE
                if (enabled && historyAction === 'POP') {
                    return true;
                }
                return false;
            },
            [enabled]
        )
    );

    // Handle the blocked navigation
    useEffect(() => {
        if (blocker.state === 'blocked') {
            // Execute the handler (e.g., close modal)
            // We wrap in async to handle potential promises, though usually sync
            Promise.resolve(handler()).then(() => {
                // After handling, we reset the blocker.
                // We do NOT proceed with the navigation because the handler's purpose
                // was to INTERCEPT the back action (e.g. close modal instead of go back).
                blocker.reset();
            });
        }
    }, [blocker, handler]);
};
