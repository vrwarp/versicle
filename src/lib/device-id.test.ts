import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('DeviceId Service', () => {
    let originalCrypto: Crypto;

    beforeEach(async () => {
        vi.resetModules();
        localStorage.clear();
        originalCrypto = global.crypto;
    });

    afterEach(() => {
        Object.defineProperty(global, 'crypto', {
            value: originalCrypto,
            configurable: true,
            writable: true
        });
    });

    it('should generate a device ID with the correct prefix', async () => {
        const { getDeviceId } = await import('./device-id');
        const deviceId = getDeviceId();
        expect(deviceId).toMatch(/^device-[a-z0-9]{8}$/);
    });

    it('should use crypto.randomUUID when available', async () => {
        const mockRandomUUID = vi.fn().mockReturnValue('12345678-1234-1234-1234-123456789012');
        Object.defineProperty(global, 'crypto', {
            value: {
                ...originalCrypto,
                randomUUID: mockRandomUUID,
            },
            configurable: true,
            writable: true
        });

        const { getDeviceId } = await import('./device-id');
        const deviceId = getDeviceId();
        expect(deviceId).toBe('device-12345678');
        expect(mockRandomUUID).toHaveBeenCalled();
    });

    it('should use crypto.getRandomValues when randomUUID is not available', async () => {
        Object.defineProperty(global, 'crypto', {
            value: {
                getRandomValues: (array: Uint32Array) => {
                    array[0] = 123456789; // '21i3v9' in base36
                    return array;
                },
            },
            configurable: true,
            writable: true
        });

        const { getDeviceId } = await import('./device-id');
        const deviceId = getDeviceId();
        // 123456789.toString(36) is '21i3v9'
        // .padStart(8, '0') is '0021i3v9'
        expect(deviceId).toBe('device-0021i3v9');
    });

    it('should fallback to Math.random when crypto is not available', async () => {
        Object.defineProperty(global, 'crypto', {
            value: undefined,
            configurable: true,
            writable: true
        });

        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

        const { getDeviceId } = await import('./device-id');
        const deviceId = getDeviceId();

        expect(deviceId).toMatch(/^device-[a-z0-9]+$/);
        expect(Math.random).toHaveBeenCalled();
    });

    it('should persist the device ID in localStorage', async () => {
        const { getDeviceId } = await import('./device-id');
        const deviceId = getDeviceId();
        const storedId = localStorage.getItem('versicle-device-id');
        expect(storedId).toBe(deviceId);
    });

    it('should return the same device ID from localStorage after "reload"', async () => {
        const { getDeviceId } = await import('./device-id');
        const firstId = getDeviceId();

        vi.resetModules();
        const { getDeviceId: getDeviceIdReloaded } = await import('./device-id');

        const secondId = getDeviceIdReloaded();
        expect(secondId).toBe(firstId);
        expect(localStorage.getItem('versicle-device-id')).toBe(firstId);
    });
});
