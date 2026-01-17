import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDeviceStore } from './useDeviceStore';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock yjs-provider
vi.mock('./yjs-provider', () => ({
    yDoc: {
        getMap: vi.fn(() => ({
            observe: vi.fn(),
            toJSON: () => ({}),
            set: vi.fn(),
            get: vi.fn(),
        })),
        transact: (cb: any) => cb(),
    }
}));

// Mock zustand-middleware-yjs
vi.mock('zustand-middleware-yjs', () => ({
    default: (_doc: any, _name: any, config: any) => config
}));

describe('useDeviceStore', () => {
    beforeEach(() => {
        useDeviceStore.setState({ devices: {} });
    });

    it('should register a device name', () => {
        const { setDeviceName } = useDeviceStore.getState();
        setDeviceName('device-123', 'My iPad');

        expect(useDeviceStore.getState().devices['device-123']).toBe('My iPad');
    });

    it('should update an existing device name', () => {
        const { setDeviceName } = useDeviceStore.getState();
        setDeviceName('device-123', 'My iPad');
        setDeviceName('device-123', 'My iPhone');

        expect(useDeviceStore.getState().devices['device-123']).toBe('My iPhone');
    });
});
