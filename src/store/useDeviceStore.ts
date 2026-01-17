import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';

/**
 * Store for managing known devices in the sync mesh.
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
interface DeviceState {
    // === SYNCED STATE (persisted to Yjs) ===
    /** Map of device IDs to device names */
    devices: Record<string, string>;

    // === ACTIONS ===
    /**
     * Registers or updates a device name.
     */
    setDeviceName: (deviceId: string, name: string) => void;
}

export const useDeviceStore = create<DeviceState>()(
    yjs(
        yDoc,
        'devices', // Shared map name in Yjs
        (set) => ({
            devices: {},

            setDeviceName: (deviceId, name) =>
                set((state) => ({
                    devices: {
                        ...state.devices,
                        [deviceId]: name
                    }
                })),
        })
    )
);
