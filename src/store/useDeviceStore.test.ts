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

    it('should register a device with a custom name', () => {
        const { registerCurrentDevice } = useDeviceStore.getState();
        const mockProfile = {
            theme: 'light' as const,
            fontSize: 100,
            ttsVoiceURI: 'voice-1',
            ttsRate: 1.0,
            ttsPitch: 1.0
        };

        registerCurrentDevice('device-custom', mockProfile, 'My Custom Pad');

        const device = useDeviceStore.getState().devices['device-custom'];
        expect(device).toBeDefined();
        expect(device.name).toBe('My Custom Pad');
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
        // Since renameDevice reads from STORE state (get()), we need to populate store first.
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
    it('should NOT wipe other devices on register (race condition check)', () => {
        // Setup initial state with an existing device
        useDeviceStore.setState({
            devices: {
                'device-existing': {
                    id: 'device-existing',
                    name: 'Existing Device',
                    created: Date.now(),
                    lastActive: Date.now(),
                    profile: {} as any
                } as any
            }
        });

        // Register a NEW device
        const { registerCurrentDevice } = useDeviceStore.getState();
        registerCurrentDevice('device-new', {} as any);

        const devices = useDeviceStore.getState().devices;
        expect(devices['device-new']).toBeDefined();

        // CRITICAL: Ensure existing device is still there
        // If the implementation does `set({ devices: { ...state.devices, [new]: ... } })`
        // AND `state.devices` was stale or Yjs merge logic treats it as a full replacement,
        // this might fail in a real distributed scenario, but locally it should pass unless logic is flawed.
        expect(devices['device-existing']).toBeDefined();
    });
});
