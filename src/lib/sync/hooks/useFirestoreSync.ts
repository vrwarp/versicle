/**
 * React hook for Firebase/Firestore sync integration.
 *
 * Since the P4 SyncEvent bus landed, this hook no longer mirrors manager
 * state into useSyncStore — `src/app/sync/wireSyncEvents.ts` is the single
 * subscriber that owns those writes (including `lastSyncTime`, which is
 * driven by `flushed` events instead of the old connected-transition stamp
 * this hook used to fake it with). What remains:
 *
 *  - the settings-driven (re)initialization effect: boot's `syncInit` task
 *    handles the configured-at-boot case, but enabling/configuring Firebase
 *    from the settings UI must initialize without a reload;
 *  - the signIn/signOut commands and the isConfigured derivation.
 */
import { useEffect, useCallback, useMemo } from 'react';
import { getFirestoreSyncManager } from '../FirestoreSyncManager';
import { useSyncStore } from '@store/useSyncStore';
import { isMockFirestoreEnabled } from '../../../test-flags';

export const useFirestoreSync = () => {
    const firebaseEnabled = useSyncStore(state => state.firebaseEnabled);
    const firebaseConfig = useSyncStore(state => state.firebaseConfig);

    // Compute if config is valid based on store state
    const isConfigured = useMemo(() => {
        const isMock = isMockFirestoreEnabled();
        if (isMock) return true;

        return !!(
            firebaseConfig.apiKey &&
            firebaseConfig.authDomain &&
            firebaseConfig.projectId &&
            firebaseConfig.appId
        );
    }, [firebaseConfig]);

    // Initialize sync manager when Firebase is enabled AND configured
    useEffect(() => {
        const isMock = isMockFirestoreEnabled();

        if ((!firebaseEnabled || !isConfigured) && !isMock) {
            return;
        }

        // Idempotent for the already-initialized boot case; picks up
        // settings-time enablement without a reload.
        void getFirestoreSyncManager().initialize();
    }, [firebaseEnabled, isConfigured]);

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
