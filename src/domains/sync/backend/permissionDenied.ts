/**
 * BYO-Firebase rules-lockout detection: when the user's deployed security
 * rules are older than what the app expects, Firestore / Cloud Storage start
 * rejecting writes with permission-denied. ProviderConnection tags failure
 * events with this predicate's verdict; presentation (wireSyncEvents) turns it
 * into the user-facing message.
 *
 * The user-facing COPY lives in the typed catalog (kernel/locale/messages.ts
 * key 'sync.rulesOutOfDate') — the transport keeps only the detection
 * predicate below.
 */

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
