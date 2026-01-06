import * as Y from 'yjs';

// We need to define the keys we are looking for in localStorage
const LEGACY_KEYS = {
  READER: 'reader-storage',
  SYNC: 'sync-storage',
};

// We need to define where in the Y.Doc these settings will live.
// Since these are "global" settings not tied to a specific book,
// we should probably have a 'settings' map.
// However, the current CRDT schema (types.ts) doesn't have a 'settings' key.
// I will check the plan again.
// Plan says: "For example, the theme key in the UI store moves to a Y.Map value."
// It doesn't specify the parent key. I will assume a new top-level map 'settings'.
// Updated: We use CRDT_KEYS.SETTINGS now.

import { CRDT_KEYS } from './types';

export const SETTINGS_KEY = CRDT_KEYS.SETTINGS;

export class LegacyStorageBridge {
  private doc: Y.Doc;

  constructor(doc: Y.Doc) {
    this.doc = doc;
  }

  /**
   * Migrates legacy localStorage data to the Y.Doc.
   * This should be called on app startup.
   */
  migrateLocalStorageToState(): void {
    const settingsMap = this.doc.getMap(SETTINGS_KEY);

    // 1. Migrate Reader Settings
    const readerStorageRaw = localStorage.getItem(LEGACY_KEYS.READER);
    if (readerStorageRaw) {
      try {
        const parsed = JSON.parse(readerStorageRaw);
        const state = parsed.state; // Zustand persist wraps state in { state: ... }

        if (state) {
            // Map keys
            const keysToMigrate = [
                'currentTheme',
                'customTheme',
                'fontFamily',
                'lineHeight',
                'fontSize',
                'viewMode',
                'shouldForceFont'
            ];

            keysToMigrate.forEach(key => {
                if (state[key] !== undefined && !settingsMap.has(key)) {
                     settingsMap.set(key, state[key]);
                }
            });
        }
      } catch (e) {
        console.error('Failed to migrate reader-storage', e);
      }
    }

    // 2. Migrate Sync Settings
    const syncStorageRaw = localStorage.getItem(LEGACY_KEYS.SYNC);
    if (syncStorageRaw) {
      try {
        const parsed = JSON.parse(syncStorageRaw);
        const state = parsed.state;

        if (state) {
             const keysToMigrate = [
                'googleClientId',
                'googleApiKey',
                'isSyncEnabled'
            ];
             keysToMigrate.forEach(key => {
                if (state[key] !== undefined && !settingsMap.has(key)) {
                    settingsMap.set(key, state[key]);
                }
            });
        }

      } catch (e) {
        console.error('Failed to migrate sync-storage', e);
      }
    }
  }

  /**
   * Clears legacy localStorage keys.
   * Should be called only after we are sure Yjs has persisted the data.
   */
  clearLegacyStorage(): void {
     // NOTE: As per plan "Phase 2A", we only clear after hydration is confirmed.
     // For now, I will implement the method but the caller is responsible for timing.
     localStorage.removeItem(LEGACY_KEYS.READER);
     localStorage.removeItem(LEGACY_KEYS.SYNC);
  }
}
