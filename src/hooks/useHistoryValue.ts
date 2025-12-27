import { useState, useEffect, useCallback } from 'react';

/**
 * A hook to manage a value state that is synchronized with browser history.
 * Useful for mutually exclusive sidebars where switching modifies history.
 */
export function useHistoryValue<T>(key: string, defaultValue: T) {
    const [value, setValueInternal] = useState<T>(() => {
        if (typeof window !== 'undefined' && window.history.state && window.history.state[key] !== undefined) {
            return window.history.state[key];
        }
        return defaultValue;
    });

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            const state = event.state;
            if (state && state[key] !== undefined) {
                setValueInternal(state[key]);
            } else {
                setValueInternal(defaultValue);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [key, defaultValue]);

    const setValue = useCallback((newValue: T) => {
        setValueInternal(prev => {
            if (prev === newValue) return prev;

            if (newValue === defaultValue) {
                // Closing / Resetting
                if (window.history.state && window.history.state[key] !== undefined) {
                    window.history.back();
                    return prev; // Wait for popstate
                } else {
                    return defaultValue;
                }
            } else {
                // Opening or Switching
                if (prev === defaultValue) {
                    // Default -> New: Push
                    window.history.pushState({ ...window.history.state, [key]: newValue }, '');
                } else {
                    // New A -> New B: Replace
                    window.history.replaceState({ ...window.history.state, [key]: newValue }, '');
                }
                return newValue;
            }
        });
    }, [key, defaultValue]);

    return [value, setValue] as const;
}
