import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';

export interface DeviceInfo {
    name: string;
    lastActive: number;
    created: number;
}

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
     * Registers or updates a device.
     */
    registerDevice: (deviceId: string, name: string) => void;

    /**
     * Updates the last active timestamp for a device.
     */
    touchDevice: (deviceId: string) => void;
}

export const useDeviceStore = create<DeviceState>()(
    yjs(
        yDoc,
        'devices', // Shared map name in Yjs
        (set) => ({
            devices: {},

            registerDevice: (deviceId, name) =>
                set((state) => {
                    const existing = state.devices[deviceId];
                    const now = Date.now();
                    return {
                        devices: {
                            ...state.devices,
                            [deviceId]: {
                                name,
                                created: existing ? existing.created : now,
                                lastActive: now
                            }
                        }
                    };
                }),

            touchDevice: (deviceId) =>
                set((state) => {
                    const existing = state.devices[deviceId];
                    if (!existing) return state;
                    return {
                        devices: {
                            ...state.devices,
                            [deviceId]: {
                                ...existing,
                                lastActive: Date.now()
                            }
                        }
                    };
                }),
        })
    )
);
