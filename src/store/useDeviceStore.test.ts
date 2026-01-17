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

        const { registerCurrentDevice } = useDeviceStore.getState();
        const mockProfile = {
            theme: 'light' as const,
            fontSize: 100,
            ttsVoiceURI: 'voice-1',
            ttsRate: 1.0,
            ttsPitch: 1.0
        };

        registerCurrentDevice('device-123', mockProfile);

        const device = useDeviceStore.getState().devices['device-123'];
        // Name will be "Unknown on Unknown" because UA parser mocks are empty/default in test env
        expect(device).toMatchObject({
            id: 'device-123',
            created: now,
            lastActive: now,
            profile: mockProfile
        });
        expect(device.name).toBeDefined();
    });

    it('should update a device name without changing created date', () => {
        // registerCurrentDevice doesn't take name anymore, it auto-generates or keeps existing.
        // To test rename, we use renameDevice.

        const t1 = 1000;
        vi.setSystemTime(t1);
        const { registerCurrentDevice, renameDevice } = useDeviceStore.getState();
        const mockProfile = {
            theme: 'light' as const,
            fontSize: 100,
            ttsVoiceURI: 'voice-1',
            ttsRate: 1.0,
            ttsPitch: 1.0
        };
        registerCurrentDevice('device-123', mockProfile);

        const t2 = 2000;
        vi.setSystemTime(t2);
        renameDevice('device-123', 'My iPhone');

        const device = useDeviceStore.getState().devices['device-123'];
        expect(device.name).toBe('My iPhone');
        expect(device.created).toBe(t1);
        // renameDevice shouldn't necessarily update lastActive, but let's check store impl
        // The implementation says: if (!existing) return state; return { ... [deviceId]: { ...existing, name } }
        // It does NOT update lastActive.
        // Wait, the previous test expected lastActive to be t2? No, that was a register call. 
        // Here we just check name update.
    });

    it('should touch a device to update last active', () => {
        const t1 = 1000;
        vi.setSystemTime(t1);
        const { registerCurrentDevice, touchDevice } = useDeviceStore.getState();
        const mockProfile = {
            theme: 'light' as const,
            fontSize: 100,
            ttsVoiceURI: 'voice-1',
            ttsRate: 1.0,
            ttsPitch: 1.0
        };
        registerCurrentDevice('device-123', mockProfile);

        // Advance time > 5 mins to bypass throttle
        const t2 = t1 + 6 * 60 * 1000;
        vi.setSystemTime(t2);

        touchDevice('device-123');

        const device = useDeviceStore.getState().devices['device-123'];
        expect(device.lastActive).toBe(t2);
        expect(device.created).toBe(t1);
    });

    it('should delete a device', () => {
        const { registerCurrentDevice, deleteDevice } = useDeviceStore.getState();
        const mockProfile = {
            theme: 'light' as const,
            fontSize: 100,
            ttsVoiceURI: 'voice-1',
            ttsRate: 1.0,
            ttsPitch: 1.0
        };
        registerCurrentDevice('device-123', mockProfile);

        expect(useDeviceStore.getState().devices['device-123']).toBeDefined();

        deleteDevice('device-123');
        expect(useDeviceStore.getState().devices['device-123']).toBeUndefined();
    });
});
