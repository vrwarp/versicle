import { App } from '@capacitor/app';
import { useEffect, useRef, useCallback } from 'react';
import { useBackNavigationStore } from '../store/useBackNavigationStore';
import { useNavigate, useLocation, useBlocker, type BlockerFunction } from 'react-router-dom';
import { createLogger } from '../lib/logger';

const logger = createLogger('BackNavigationManager');

/**
 * Global manager for Back Navigation (Hardware Button & Browser Back).
 *
 * 1. Listens to Capacitor's 'backButton' event (Android Hardware Button).
 * 2. Uses React Router's `useBlocker` to intercept browser back navigation.
 *
 * If handlers are registered in `useBackNavigationStore`:
 * - Intercepts the back action.
 * - Executes the highest priority handler (e.g., close modal).
 * - Prevents actual navigation.
 *
 * If no handlers are registered:
 * - Allows default navigation / App exit.
 */
export const BackNavigationManager = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // Access store directly to avoid unnecessary re-renders
    // We only need the current state when an event occurs.
    const getHandlers = () => useBackNavigationStore.getState().handlers;

    // Use a ref to access current location inside the event listener
    const locationRef = useRef(location);
    useEffect(() => {
        locationRef.current = location;
    }, [location]);

    /**
     * Common logic to execute the highest priority handler.
     * Returns true if a handler was executed, false otherwise.
     */
    const executeHandler = useCallback(async (): Promise<boolean> => {
        const handlers = getHandlers();
        if (handlers.length > 0) {
            const topHandler = handlers[0];
            logger.debug(`Executing back handler: ${topHandler.id} (Priority: ${topHandler.priority})`);
            await topHandler.handler();
            return true;
        }
        return false;
    }, []);

    // ---------------------------------------------------------------------------
    // 1. Browser Back Button Interception (useBlocker)
    // ---------------------------------------------------------------------------

    // Block navigation if:
    // - Action is POP (Back/Forward button)
    // - We have handlers registered with priority > DEFAULT (0)
    // We don't want to block standard page navigation if only default low-priority listeners exist (if any).
    // But typically, overlays will register with higher priority.
    const shouldBlock = useCallback<BlockerFunction>(({ historyAction, nextLocation }) => {
        if (historyAction !== 'POP') return false;

        // Don't block if we are just navigating to the same place (sometimes happens)
        if (nextLocation.key === location.key) return false;

        const handlers = getHandlers();
        // Check if we have any "guard" level handlers. 
        // We assume anything registered here intended to trap the back button.
        // If you have a handler that shouldn't block browser back, it should probably not be here or have a specific flag.
        // For now, presence of any handler implies we might want to intercept.
        const hasHandlers = handlers.length > 0;

        return hasHandlers;
    }, [location]);

    const blocker = useBlocker(shouldBlock);

    useEffect(() => {
        if (blocker.state === 'blocked') {
            const handleBlockedNavigation = async () => {
                const handled = await executeHandler();
                if (handled) {
                    // Handled internally (e.g. modal closed). 
                    // Reset the blocker to 'unblocked' state without navigating.
                    blocker.reset();
                } else {
                    // No handler actually ran (race condition?), allow navigation.
                    blocker.proceed();
                }
            };
            handleBlockedNavigation();
        }
    }, [blocker, executeHandler]);


    // ---------------------------------------------------------------------------
    // 2. Android Hardware Back Button (Capacitor)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const listenerPromise = App.addListener('backButton', async () => {
            const handled = await executeHandler();

            if (!handled) {
                // Default behavior
                if (locationRef.current.pathname === '/') {
                    // At root, exit the app
                    App.exitApp();
                } else {
                    // Navigate back
                    if (window.history.length > 1) {
                        navigate(-1);
                    } else {
                        // If no history, go home
                        navigate('/', { replace: true });
                    }
                }
            }
        });

        return () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            listenerPromise.then((l: any) => l.remove());
        };
    }, [navigate, executeHandler]);

    return null;
};
