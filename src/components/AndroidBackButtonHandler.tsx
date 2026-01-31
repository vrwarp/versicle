import { App } from '@capacitor/app';
import { useEffect, useRef } from 'react';
import { useAndroidBackButtonStore } from '../store/useAndroidBackButtonStore';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Global handler for the Android Back Button event.
 * Listens to Capacitor's 'backButton' event and delegates to registered handlers
 * or performs default navigation.
 */
export const AndroidBackButtonHandler = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // Use a ref to access current location inside the event listener
    // without re-binding the listener on every navigation.
    const locationRef = useRef(location);

    useEffect(() => {
        locationRef.current = location;
    }, [location]);

    useEffect(() => {
        const listenerPromise = App.addListener('backButton', async () => {
            const handlers = useAndroidBackButtonStore.getState().handlers;

            if (handlers.length > 0) {
                // Execute the highest priority handler
                await handlers[0].handler();
            } else {
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

        // Cleanup listener on unmount
        return () => {
            listenerPromise.then(l => l.remove());
        };
    }, [navigate]); // Only re-bind if navigate function changes (unlikely)

    return null;
};
