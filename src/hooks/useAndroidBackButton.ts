import { useEffect, useId } from 'react';
import { useAndroidBackButtonStore, type BackButtonHandler } from '../store/useAndroidBackButtonStore';

/**
 * Hook to register a back button handler.
 * @param handler The function to execute when the back button is pressed.
 * @param priority The priority of the handler (use BackButtonPriority enum).
 * @param enabled Whether the handler should be active.
 */
export const useAndroidBackButton = (handler: BackButtonHandler, priority: number, enabled: boolean = true) => {
    const id = useId();
    const register = useAndroidBackButtonStore((state) => state.registerHandler);
    const unregister = useAndroidBackButtonStore((state) => state.unregisterHandler);

    useEffect(() => {
        if (enabled) {
            register(id, handler, priority);
        }
        return () => {
            unregister(id);
        };
    }, [id, handler, priority, enabled, register, unregister]);
};
