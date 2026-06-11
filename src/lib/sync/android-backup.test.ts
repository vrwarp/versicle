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

    it('should read a valid backup payload', async () => {
        const manifest = { version: 3, timestamp: new Date().toISOString(), yjsSnapshot: 'AAEC' };
        vi.mocked(Filesystem.readFile).mockResolvedValue({ data: JSON.stringify(manifest) });

        const result = await AndroidBackupService.readBackupPayload();
        expect(result).toEqual(manifest);
    });

    it('rejects a payload that fails envelope validation (untrusted ingress, P3 D4)', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        // Legacy/garbage payload: version 1, no yjsSnapshot — must never be
        // handed to a restore path.
        vi.mocked(Filesystem.readFile).mockResolvedValue({ data: JSON.stringify({ version: 1 }) });

        const result = await AndroidBackupService.readBackupPayload();
        expect(result).toBeNull();
        warnSpy.mockRestore();
    });

    it('should handle read errors gracefully', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('File not found'));
        const result = await AndroidBackupService.readBackupPayload();
        expect(result).toBeNull();
    });
});
