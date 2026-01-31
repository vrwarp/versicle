import { useEffect, useId } from 'react';
import { useBackButtonStore, BackButtonHandler } from '../store/useBackButtonStore';

/**
 * Hook to register a back button handler.
 * @param handler The function to execute when the back button is pressed.
 * @param priority The priority of the handler (higher numbers run first).
 * @param enabled Whether the handler should be active.
 */
export const useBackButton = (handler: BackButtonHandler, priority: number, enabled: boolean = true) => {
    const id = useId();
    const register = useBackButtonStore((state) => state.registerHandler);
    const unregister = useBackButtonStore((state) => state.unregisterHandler);

    useEffect(() => {
        if (enabled) {
            register(id, handler, priority);
        }
        return () => {
            unregister(id);
        };
    }, [id, handler, priority, enabled, register, unregister]);
};
