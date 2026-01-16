import { yDoc } from '../../store/yjs-provider';

/**
 * DANGER: Clears all Yjs data and resets migration flag.
 * Use only for recovery.
 */
export async function resetYjsData(): Promise<void> {
    if (!confirm('⚠️ Reset all synced data? This cannot be undone!')) {
        return;
    }

    // Clear all maps
    const maps = ['library', 'annotations', 'preferences', 'progress'];

    yDoc.transact(() => {
        maps.forEach(name => {
            const map = yDoc.getMap(name);
            map.clear();
        });

        // Reset migration flag
        const prefsMap = yDoc.getMap('preferences');
        prefsMap.delete('migration_complete');
        prefsMap.delete('migration_timestamp');
    });

    console.log('[Reset] Yjs data cleared. Reload to re-migrate.');

    // Force page reload
    setTimeout(() => window.location.reload(), 500);
}
