import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LegacyStorageBridge } from '../LegacyStorageBridge';
import { CRDTService } from '../CRDTService';
import { CRDT_KEYS } from '../types';

describe('LegacyStorageBridge', () => {
    let mockCRDTService: any;

    beforeEach(() => {
        // Mock localStorage
        vi.spyOn(Storage.prototype, 'getItem');
        vi.spyOn(Storage.prototype, 'removeItem');

        // Mock CRDTService
        const settingsMap = new Map();
        mockCRDTService = {
            settings: {
                set: vi.fn((key, value) => settingsMap.set(key, value)),
                get: vi.fn((key) => settingsMap.get(key)),
            }
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should migrate sync-storage if present', () => {
        const legacyState = { state: { isSyncEnabled: true, googleClientId: '123' }, version: 0 };
        vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(legacyState));

        LegacyStorageBridge.migrateLocalStorage(mockCRDTService as unknown as CRDTService);

        // Verify write to CRDT
        expect(mockCRDTService.settings.set).toHaveBeenCalledWith(
            'sync-storage',
            JSON.stringify(legacyState.state)
        );

        // Verify deletion from localStorage
        expect(localStorage.removeItem).toHaveBeenCalledWith('sync-storage');
    });

    it('should do nothing if sync-storage is missing', () => {
        vi.mocked(localStorage.getItem).mockReturnValue(null);

        LegacyStorageBridge.migrateLocalStorage(mockCRDTService as unknown as CRDTService);

        expect(mockCRDTService.settings.set).not.toHaveBeenCalled();
        expect(localStorage.removeItem).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', () => {
        vi.mocked(localStorage.getItem).mockReturnValue('{ invalid json');

        LegacyStorageBridge.migrateLocalStorage(mockCRDTService as unknown as CRDTService);

        expect(mockCRDTService.settings.set).not.toHaveBeenCalled();
        expect(localStorage.removeItem).not.toHaveBeenCalled();
    });
});
