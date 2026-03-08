import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { BackupManifestV2 } from '../BackupService';
import { backupService } from '../BackupService';
import { createLogger } from '../logger';

const logger = createLogger('AndroidBackupService');

const BACKUP_FILENAME = 'backup_payload.json';

/**
 * Service to handle native Android backup integration.
 * Writes the SyncManifest to a file that Android's BackupManager can pick up.
 */
export class AndroidBackupService {
    /**
     * Writes the backup payload to the app's data directory.
     * Uses the V2 Backup Manifest.
     */
    static async writeBackupPayload(): Promise<void> {
        try {
            const manifest: BackupManifestV2 = await backupService.generateManifest();
            await Filesystem.writeFile({
                path: BACKUP_FILENAME,
                data: JSON.stringify(manifest),
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
            logger.info('Backup payload written successfully.');
        } catch (e) {
            logger.error('Failed to write Android backup payload', e);
        }
    }

    /**
     * Reads the backup payload (useful for debugging or restore verification).
     */
    static async readBackupPayload(): Promise<BackupManifestV2 | null> {
        try {
            const result = await Filesystem.readFile({
                path: BACKUP_FILENAME,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            if (typeof result.data === 'string') {
                return JSON.parse(result.data) as BackupManifestV2;
            }
            return null;
        } catch (e) {
            logger.warn('No backup payload found or failed to read', e);
            return null;
        }
    }
}
