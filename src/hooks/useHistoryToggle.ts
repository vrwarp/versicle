import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * A hook to manage a boolean state that is synchronized with the browser history.
 * Pushes a new state to history when set to true, and handles popstate (Back button) to set it to false.
 *
 * @param key Unique key for the history state
 * @param initialState Initial boolean state
 * @returns [isOpen, setIsOpen]
 */
export function useHistoryToggle(key: string, initialState = false) {
    // Initialize state from history if available
    const [isOpen, setIsOpenInternal] = useState(() => {
        if (typeof window !== 'undefined' && window.history.state && window.history.state[key]) {
            return true;
        }
        return initialState;
    });
    const isHandlingPopState = useRef(false);

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const state = event.state;
            const hasKey = state && typeof state === 'object' && state[key];

            if (isOpen && !hasKey) {
                isHandlingPopState.current = true;
                setIsOpenInternal(false);
                isHandlingPopState.current = false;
            } else if (!isOpen && hasKey) {
                 isHandlingPopState.current = true;
                 setIsOpenInternal(true);
                 isHandlingPopState.current = false;
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isOpen, key]);

    const setIsOpen = useCallback((open: boolean) => {
        setIsOpenInternal(current => {
            if (current === open) return current;

            if (open) {
                // Opening: Push state
                window.history.pushState({ ...window.history.state, [key]: true }, '');
            } else {
                // Closing:
                // If we are closing via UI, we want to go back to remove the history entry.
                // But only if we are currently in the state that has our key.
                if (window.history.state && window.history.state[key]) {
                    window.history.back();
                    // We don't set internal state here immediately if we want to wait for popstate?
                    // But popstate is async. For UI responsiveness, we might want to set it.
                    // But if we set it, the popstate handler might get confused or run redundantly.
                    // The safer way for "Back" emulation is just calling back() and letting the effect handle it.
                    // However, if the user manually modifies history, this might break.

                    // Let's rely on popstate for the actual state change to ensure sync.
                    return current;
                } else {
                    // Fallback: If history doesn't match, just close.
                    return false;
                }
            }
            return open;
        });
    }, [key]);

    return [isOpen, setIsOpen] as const;
}
