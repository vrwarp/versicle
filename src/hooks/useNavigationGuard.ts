import { useEffect, useId } from 'react';
import { useBackNavigationStore, type BackButtonHandler } from '../store/useBackNavigationStore';

/**
 * Hook to register a navigation guard (back button handler).
 * @param handler The function to execute when the back button is pressed.
 * @param priority The priority of the handler (use BackButtonPriority enum).
 * @param enabled Whether the handler should be active.
 */
export const useNavigationGuard = (handler: BackButtonHandler, priority: number, enabled: boolean = true) => {
    const id = useId();
    const register = useBackNavigationStore((state) => state.registerHandler);
    const unregister = useBackNavigationStore((state) => state.unregisterHandler);

    useEffect(() => {
        if (enabled) {
            register(id, handler, priority);
        }
        return () => {
            unregister(id);
        };
    }, [id, handler, priority, enabled, register, unregister]);
};
