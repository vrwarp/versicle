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

    // Check if we already have a device ID
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);

    if (!deviceId) {
        deviceId = generateDeviceId();
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
        logger.info('Generated new device ID:', deviceId);
    }

    cachedDeviceId = deviceId;
    return deviceId;
};

/**
 * Reset the device ID (for testing or troubleshooting)
 */
export const resetDeviceId = (): string => {
    const newId = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, newId);
    cachedDeviceId = newId;
    logger.info('Reset device ID to:', newId);
    return newId;
};
