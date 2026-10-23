/**
 * Device ID Service
 * 
 * Generates and persists a unique identifier for this device.
 * Used for per-device progress tracking in multi-device sync scenarios.
 */

import { createLogger } from './logger';
import { generateSecureId } from './crypto';

const logger = createLogger('DeviceId');

const DEVICE_ID_KEY = 'versicle-device-id';

let cachedDeviceId: string | null = null;

/**
 * Generate a random device ID
 */
const generateDeviceId = (): string => {
    return generateSecureId('device', '-').slice(0, 15); // device- + 8 chars
};

/**
 * Get or create the device ID for this device.
 * The ID is persisted in localStorage to remain stable across sessions.
 */
export const getDeviceId = (): string => {
    if (cachedDeviceId) {
        return cachedDeviceId;
    }

    // Check if we already have a device ID. localStorage can throw (blocked
    // site data, some private windows); the ID then lives for this session only.
    let deviceId: string | null = null;
    try {
        deviceId = localStorage.getItem(DEVICE_ID_KEY);
    } catch (e) {
        logger.warn('localStorage unavailable; device ID will not persist', e);
    }

    if (!deviceId) {
        deviceId = generateDeviceId();
        try {
            localStorage.setItem(DEVICE_ID_KEY, deviceId);
        } catch (e) {
            logger.warn('Could not persist device ID; using a session-only ID', e);
        }
        logger.info('Generated new device ID:', deviceId);
    }

    cachedDeviceId = deviceId;
    return deviceId;
};
