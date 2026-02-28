/**
 * Device ID Service
 * 
 * Generates and persists a unique identifier for this device.
 * Used for per-device progress tracking in multi-device sync scenarios.
 */

import { createLogger } from './logger';

const logger = createLogger('DeviceId');

const DEVICE_ID_KEY = 'versicle-device-id';

let cachedDeviceId: string | null = null;

/**
 * Generate a random device ID
 */
const generateDeviceId = (): string => {
    // Use crypto.randomUUID if available, otherwise fallback
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `device-${crypto.randomUUID().slice(0, 8)}`;
    }
    // Fallback for older browsers
    const random = Math.random().toString(36).substring(2, 10);
    return `device-${random}`;
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
