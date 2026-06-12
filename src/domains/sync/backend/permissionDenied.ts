/**
 * BYO-Firebase rules-lockout detection (the P0 hotfix graft): when the
 * user's deployed security rules are older than what the app expects,
 * Firestore / Cloud Storage start rejecting writes with permission-denied.
 * Moved here from FirestoreSyncManager (P4-3a) so presentation
 * (wireSyncEvents) and transports can share it without importing the
 * manager module.
 */

/** User-facing hint for the rules-lockout case. */
export const RULES_OUT_OF_DATE_MESSAGE =
    'Cloud sync was rejected by your Firebase project\'s security rules. Your deployed rules are likely out of date — redeploy firestore.rules and storage.rules from the Versicle repository (firebase deploy --only firestore:rules,storage).';

/**
 * Detects a Firebase permission-denied error anywhere in a provider event
 * payload (events nest the original error under `error`, and errors may chain
 * via `cause`).
 */
export function isPermissionDeniedEvent(event: unknown): boolean {
    let current: unknown = event;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
        const candidate = current as { code?: unknown; message?: unknown; error?: unknown; cause?: unknown };
        const code = typeof candidate.code === 'string' ? candidate.code : '';
        const message = typeof candidate.message === 'string' ? candidate.message : '';
        if (
            code === 'permission-denied' ||
            code === 'storage/unauthorized' ||
            message.includes('permission-denied') ||
            message.includes('Missing or insufficient permissions')
        ) {
            return true;
        }
        current = candidate.error ?? candidate.cause;
    }
    return false;
}
