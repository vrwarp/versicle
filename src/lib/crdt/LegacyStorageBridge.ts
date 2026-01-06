import { CRDTService } from './CRDTService';
import { Logger } from '../logger';

/**
 * Bridge to migrate data from legacy localStorage to CRDT settings.
 */
export class LegacyStorageBridge {
  private static readonly SYNC_STORAGE_KEY = 'sync-storage';

  /**
   * Migrates data from localStorage to CRDT settings.
   * On success, deletes the localStorage key.
   */
  static migrateLocalStorage(crdtService: CRDTService) {
    try {
      const syncStorageRaw = localStorage.getItem(this.SYNC_STORAGE_KEY);
      if (!syncStorageRaw) return;

      const syncStorage = JSON.parse(syncStorageRaw);
      const state = syncStorage.state;

      if (state) {
        // We write the entire state object as a single value to match
        // the granularity of zustand/persist which usually expects a JSON blob.
        // However, here we can be smarter and store individual fields if we wanted.
        // But to keep it compatible with a generic storage adapter, storing the JSON string
        // under the key 'sync-storage' in the settings map is easiest.

        // Wait, CRDT Map keys are strings, values can be any JSON type.
        // We can store the whole state object under 'sync-storage'.
        crdtService.settings.set(this.SYNC_STORAGE_KEY, JSON.stringify(state));

        Logger.info('LegacyStorageBridge', 'Migrated sync-storage to CRDT');
      }

      // Decommissioning: Delete from localStorage
      localStorage.removeItem(this.SYNC_STORAGE_KEY);
      Logger.info('LegacyStorageBridge', 'Deleted legacy sync-storage from localStorage');

    } catch (error) {
      Logger.error('LegacyStorageBridge', 'Migration failed', error);
    }
  }
}
