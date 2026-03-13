import { describe, it, expect, vi, afterEach } from 'vitest';
import { AndroidBackupService } from './android-backup';
import { Filesystem } from '@capacitor/filesystem';

import { backupService } from '../BackupService';

// Mock BackupService
vi.mock('../BackupService', () => ({
    backupService: {
        generateManifest: vi.fn(),
    }
}));

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

    it('should write backup payload from generateManifest', async () => {
        const mockManifest = { version: 2, yjsSnapshot: 'test' };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(backupService.generateManifest).mockResolvedValue(mockManifest as any);

        await AndroidBackupService.writeBackupPayload();

        expect(backupService.generateManifest).toHaveBeenCalled();
        expect(Filesystem.writeFile).toHaveBeenCalledWith({
            path: 'backup_payload.json',
            data: JSON.stringify(mockManifest),
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
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('File not found'));
        const result = await AndroidBackupService.readBackupPayload();
        expect(result).toBeNull();
    });
});
