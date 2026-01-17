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
        vi.useFakeTimers();
    });

    it('should register a device', () => {
        const now = Date.now();
        vi.setSystemTime(now);

        const { registerDevice } = useDeviceStore.getState();
        registerDevice('device-123', 'My iPad');

        const device = useDeviceStore.getState().devices['device-123'];
        expect(device).toEqual({
            name: 'My iPad',
            created: now,
            lastActive: now
        });
    });

    it('should update a device name without changing created date', () => {
        const t1 = 1000;
        vi.setSystemTime(t1);
        const { registerDevice } = useDeviceStore.getState();
        registerDevice('device-123', 'My iPad');

        const t2 = 2000;
        vi.setSystemTime(t2);
        registerDevice('device-123', 'My iPhone');

        const device = useDeviceStore.getState().devices['device-123'];
        expect(device).toEqual({
            name: 'My iPhone',
            created: t1,
            lastActive: t2
        });
    });

    it('should touch a device to update last active', () => {
        const t1 = 1000;
        vi.setSystemTime(t1);
        const { registerDevice, touchDevice } = useDeviceStore.getState();
        registerDevice('device-123', 'My iPad');

        const t2 = 2000;
        vi.setSystemTime(t2);
        touchDevice('device-123');

        const device = useDeviceStore.getState().devices['device-123'];
        expect(device.lastActive).toBe(t2);
        expect(device.created).toBe(t1);
    });
});
