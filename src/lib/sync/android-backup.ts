import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { BackupManifest, BackupManifestV3 } from '../BackupService';
import { backupService } from '../BackupService';
import { backupManifestEnvelopeSchema } from '@data/rows';
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
            const manifest: BackupManifestV3 = await backupService.generateManifest();
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
     *
     * Untrusted ingress (Phase 3 D4): the file on disk is outside the app's
     * control, so the parsed JSON is validated against the backup manifest
     * envelope schema (src/data/rows posture) before it is handed to anyone.
     * An unparseable or structurally invalid payload returns null.
     */
    static async readBackupPayload(): Promise<BackupManifest | null> {
        try {
            const result = await Filesystem.readFile({
                path: BACKUP_FILENAME,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            if (typeof result.data === 'string') {
                const parsed = backupManifestEnvelopeSchema.safeParse(JSON.parse(result.data));
                if (!parsed.success) {
                    logger.warn('Android backup payload failed envelope validation; ignoring it', parsed.error.issues);
                    return null;
                }
                return parsed.data as unknown as BackupManifest;
            }
            return null;
        } catch (e) {
            logger.warn('No backup payload found or failed to read', e);
            return null;
        }
    }
}
