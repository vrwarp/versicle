import { describe, it, expect, vi, afterEach } from 'vitest';
import { AndroidBackupService } from './android-backup';
import { Filesystem } from '@capacitor/filesystem';

// Mock Capacitor Filesystem
vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        writeFile: vi.fn(),
        readFile: vi.fn(),
    },
    Directory: { Data: 'DATA' },
    Encoding: { UTF8: 'utf8' }
}));

describe('AndroidBackupService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should write backup payload', async () => {
        const manifest = { version: 1 } as unknown as SyncManifest;
        await AndroidBackupService.writeBackupPayload(manifest);
        expect(Filesystem.writeFile).toHaveBeenCalledWith({
            path: 'backup_payload.json',
            data: JSON.stringify(manifest),
            directory: 'DATA',
            encoding: 'utf8'
        });
    });

    it('should read backup payload', async () => {
        const manifest = { version: 1 };
        vi.mocked(Filesystem.readFile).mockResolvedValue({ data: JSON.stringify(manifest) });

        const result = await AndroidBackupService.readBackupPayload();
        expect(result).toEqual(manifest);
    });

    it('should handle read errors gracefully', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('File not found'));
        const result = await AndroidBackupService.readBackupPayload();
        expect(result).toBeNull();
    });
});
