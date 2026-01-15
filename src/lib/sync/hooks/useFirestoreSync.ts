/**
 * React hook for Firebase/Firestore sync integration.
 * 
 * Initializes the FirestoreSyncManager and syncs its state
 * with the useSyncStore for UI reactivity.
 */
import { useEffect, useCallback, useMemo } from 'react';
import { getFirestoreSyncManager } from '../FirestoreSyncManager';
import { useSyncStore } from './useSyncStore';

/**
 * Hook to manage Firebase/Firestore sync.
 * 
 * Initializes the sync manager when Firebase is enabled,
 * and provides methods to sign in/out.
 */
export const useFirestoreSync = () => {
    const firebaseEnabled = useSyncStore(state => state.firebaseEnabled);
    const firebaseConfig = useSyncStore(state => state.firebaseConfig);
    const setFirestoreStatus = useSyncStore(state => state.setFirestoreStatus);
    const setFirebaseAuthStatus = useSyncStore(state => state.setFirebaseAuthStatus);
    const setFirebaseUserEmail = useSyncStore(state => state.setFirebaseUserEmail);
    const setLastSyncTime = useSyncStore(state => state.setLastSyncTime);

    // Compute if config is valid based on store state
    const isConfigured = useMemo(() => {
        return !!(
            firebaseConfig.apiKey &&
            firebaseConfig.authDomain &&
            firebaseConfig.projectId &&
            firebaseConfig.appId
        );
    }, [firebaseConfig]);

    // Initialize sync manager when Firebase is enabled AND configured
    useEffect(() => {
        if (!firebaseEnabled || !isConfigured) {
            return;
        }

        const manager = getFirestoreSyncManager();

        // Subscribe to status changes
        const unsubscribeStatus = manager.onStatusChange((status) => {
            setFirestoreStatus(status);
            if (status === 'connected') {
                setLastSyncTime(Date.now());
            }
        });

        const unsubscribeAuth = manager.onAuthChange((status, user) => {
            setFirebaseAuthStatus(status);
            setFirebaseUserEmail(user?.email ?? null);
        });

        // Initialize the manager
        manager.initialize();

        return () => {
            unsubscribeStatus();
            unsubscribeAuth();
        };
    }, [firebaseEnabled, isConfigured, setFirestoreStatus, setFirebaseAuthStatus, setFirebaseUserEmail, setLastSyncTime]);

    /**
     * Sign in with Google
     */
    const signIn = useCallback(async () => {
        const manager = getFirestoreSyncManager();
        await manager.signIn();
    }, []);

    /**
     * Sign out
     */
    const signOut = useCallback(async () => {
        const manager = getFirestoreSyncManager();
        await manager.signOut();
    }, []);

    return {
        signIn,
        signOut,
        isConfigured
    };
};
