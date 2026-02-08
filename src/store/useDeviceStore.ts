import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { UAParser } from 'ua-parser-js';
import { yDoc } from './yjs-provider';
import type { DeviceInfo, DeviceProfile } from '../types/device';
import packageJson from '../../package.json';

/**
 * Store for managing known devices in the sync mesh.
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
interface DeviceState {
    // === SYNCED STATE (persisted to Yjs) ===
    /** Map of device IDs to device info objects */
    devices: Record<string, DeviceInfo>;

    // === ACTIONS ===
    /**
     * Registers or updates the current device with full metadata and profile.
     */
    registerCurrentDevice: (deviceId: string, profile: DeviceProfile, name?: string) => void;

    /**
     * Updates the last active timestamp for a device.
     * Throttled to avoid excessive CRDT updates (default: 5 mins).
     */
    touchDevice: (deviceId: string) => void;

    /**
     * Updates the user-friendly name of a device.
     */
    renameDevice: (deviceId: string, name: string) => void;

    /**
     * Removes a device from the sync mesh.
     */
    deleteDevice: (deviceId: string) => void;
}

const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export const useDeviceStore = create<DeviceState>()(
    yjs(
        yDoc,
        'devices', // Shared map name in Yjs
        (set, get) => ({
            devices: {},

            registerCurrentDevice: (deviceId, profile, name) => {
                const state = get();
                const existing = state.devices[deviceId];
                const now = Date.now();

                // Parse UA if not already fully registered or update if needed
                // We always update to capture browser upgrades etc.
                const parser = new UAParser();
                const result = parser.getResult();

                // Smart Name Generation (only if new)
                let deviceName = existing?.name;
                if (name) {
                    deviceName = name;
                } else if (!deviceName) {
                    const browser = result.browser.name || 'Browser';
                    const os = result.os.name || 'Unknown OS';
                    const device = result.device.model ? ` ${result.device.model}` : '';
                    deviceName = `${browser} on ${os}${device}`;
                }

                set({
                    devices: {
                        ...state.devices,
                        [deviceId]: {
                            id: deviceId,
                            name: deviceName,
                            platform: result.os.name || 'Unknown',
                            browser: result.browser.name || 'Unknown',
                            model: result.device.model || null,
                            userAgent: result.ua,
                            appVersion: packageJson.version,
                            created: existing ? existing.created : now,
                            lastActive: now,
                            profile
                        }
                    }
                });
            },

            touchDevice: (deviceId) => {
                const state = get();
                const existing = state.devices[deviceId];
                if (!existing) return;

                const now = Date.now();
                if (now - existing.lastActive < HEARTBEAT_THROTTLE_MS) {
                    return; // Throttle
                }

                set({
                    devices: {
                        ...state.devices,
                        [deviceId]: {
                            ...existing,
                            lastActive: now
                        }
                    }
                });
            },

            renameDevice: (deviceId, name) =>
                set((state) => {
                    const existing = state.devices[deviceId];
                    if (!existing) return state;
                    return {
                        devices: {
                            ...state.devices,
                            [deviceId]: {
                                ...existing,
                                name
                            }
                        }
                    };
                }),

            deleteDevice: (deviceId) =>
                set((state) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { [deviceId]: _removed, ...rest } = state.devices;
                    return { devices: rest };
                }),
        })
    )
);
