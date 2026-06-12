/**
 * React hook for Firebase/Firestore sync integration (relocated from
 * src/lib/sync/hooks/ when FirestoreSyncManager was decomposed into the
 * sync orchestrator — P4-3; src/hooks is the established hook home).
 *
 * Since the P4 SyncEvent bus landed, this hook no longer mirrors transport
 * state into useSyncStore — `src/app/sync/wireSyncEvents.ts` is the single
 * subscriber that owns those writes (including `lastSyncTime`, which is
 * driven by `flushed` events instead of the old connected-transition stamp
 * this hook used to fake it with). What remains:
 *
 *  - the settings-driven (re)start effect: boot's `syncInit` task handles
 *    the configured-at-boot case, but enabling/configuring Firebase from
 *    the settings UI must start sync without a reload;
 *  - the signIn/signOut commands and the isConfigured derivation.
 */
import { useEffect, useCallback, useMemo } from 'react';
import { getSyncOrchestrator } from '@app/sync/createSync';
import { useSyncStore } from '@store/useSyncStore';
import { isMockFirestoreEnabled } from '../test-flags';

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

    // Start the orchestrator when Firebase is enabled AND configured
    useEffect(() => {
        const isMock = isMockFirestoreEnabled();

        if ((!firebaseEnabled || !isConfigured) && !isMock) {
            return;
        }

        // Idempotent for the already-started boot case; picks up
        // settings-time enablement without a reload.
        void getSyncOrchestrator().start();
    }, [firebaseEnabled, isConfigured]);

    /**
     * Sign in with Google
     */
    const signIn = useCallback(async () => {
        await getSyncOrchestrator().signIn();
    }, []);

    /**
     * Sign out
     */
    const signOut = useCallback(async () => {
        await getSyncOrchestrator().signOut();
    }, []);

    return {
        signIn,
        signOut,
        isConfigured
    };
};
