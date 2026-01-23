import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { SyncManifest } from '../../types/db';
import { createLogger } from '../logger';

const logger = createLogger('AndroidBackupService');

const BACKUP_FILENAME = 'backup_payload.json';

/**
 * Service to handle native Android backup integration.
 * Writes the SyncManifest to a file that Android's BackupManager can pick up.
 */
export class AndroidBackupService {
    /**
     * Writes the SyncManifest to the app's data directory.
     *
     * @param manifest The manifest to back up.
     */
    static async writeBackupPayload(manifest: SyncManifest): Promise<void> {
        try {
            await Filesystem.writeFile({
                path: BACKUP_FILENAME,
                data: JSON.stringify(manifest),
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
        } catch (e) {
            logger.error('Failed to write Android backup payload', e);
        }
    }

    /**
     * Reads the backup payload (useful for debugging or restore verification).
     */
    static async readBackupPayload(): Promise<SyncManifest | null> {
        try {
            const result = await Filesystem.readFile({
                path: BACKUP_FILENAME,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            if (typeof result.data === 'string') {
                return JSON.parse(result.data);
            }
            return null;
        } catch (e) {
            logger.warn('No backup payload found or failed to read', e);
            return null;
        }
    }
}
