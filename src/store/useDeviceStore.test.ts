import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDeviceStore } from './useDeviceStore';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock yjs-provider
vi.mock('./yjs-provider', () => ({
    getYDoc: () => ({
        getMap: vi.fn(() => ({
            observe: vi.fn(),
            toJSON: () => ({}),
            set: vi.fn(),
            get: vi.fn(),
        })),
        transact: (cb: any) => cb(),
    }),
    // Pass-through seam: this suite tests the store's ACTIONS, not the
    // middleware (the contract suite owns that).
    defineSyncedStore: (_def: any, config: any) => config,
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

    it('embedSpend survives a registerCurrentDevice call (self-clobber fix, §3.4 prereq iii)', () => {
        // registerCurrentDevice runs on EVERY boot and rebuilds the device's
        // record from a fresh literal. Without `embedSpend: existing?.embedSpend`
        // it would DELETE this device's own published spend each boot.
        useDeviceStore.setState({
            devices: {
                'device-self': {
                    id: 'device-self',
                    name: 'My Device',
                    created: 1000,
                    lastActive: 1000,
                    profile: {} as any,
                    embedSpend: { day: '2026-06-13', rpd: 5 }
                } as any
            }
        });

        // Re-register the SAME device (the every-boot path).
        const { registerCurrentDevice } = useDeviceStore.getState();
        registerCurrentDevice('device-self', {} as any);

        const device = useDeviceStore.getState().devices['device-self'];
        expect(device.embedSpend).toEqual({ day: '2026-06-13', rpd: 5 });
    });

    it('publishEmbedSpend writes only the own record via immutable spread', () => {
        useDeviceStore.setState({
            devices: {
                'device-a': {
                    id: 'device-a',
                    name: 'Device A',
                    created: 1000,
                    lastActive: 2000,
                    profile: { theme: 'dark' } as any
                } as any,
                'device-b': {
                    id: 'device-b',
                    name: 'Device B',
                    created: 3000,
                    lastActive: 4000,
                    profile: {} as any,
                    embedSpend: { day: '2026-06-12', rpd: 9 }
                } as any
            }
        });

        const { publishEmbedSpend } = useDeviceStore.getState();
        publishEmbedSpend('device-a', { day: '2026-06-13', rpd: 7 });

        const devices = useDeviceStore.getState().devices;
        // device-a got its embedSpend set...
        expect(devices['device-a'].embedSpend).toEqual({ day: '2026-06-13', rpd: 7 });
        // ...with created / profile / lastActive preserved.
        expect(devices['device-a'].created).toBe(1000);
        expect(devices['device-a'].lastActive).toBe(2000);
        expect(devices['device-a'].profile).toEqual({ theme: 'dark' });
        // device-b is untouched.
        expect(devices['device-b']).toEqual({
            id: 'device-b',
            name: 'Device B',
            created: 3000,
            lastActive: 4000,
            profile: {},
            embedSpend: { day: '2026-06-12', rpd: 9 }
        });
    });
});

/**
 * F5(a): the QuotaGovernor publishes this device's rolling daily spend on
 * EVERY embedding acquire AND commit. Each accepted publish is a synced CRDT
 * write (Y.Doc transaction → y-idb row → outbound push) and a notification to
 * every `devices` subscriber (one ResumeBadge per mounted book card). The
 * value is a coarse cross-device quota signal, so sub-step same-day moves are
 * dropped: the state object — and therefore the CRDT diff and the subscriber
 * notification — must not move.
 */
describe('regression: coalesces embed-spend publishing', () => {
    const DAY = '2026-06-13';

    const seedSelf = () => {
        useDeviceStore.setState({
            devices: {
                'device-self': {
                    id: 'device-self',
                    name: 'My Device',
                    platform: 'macOS',
                    browser: 'Chrome',
                    model: null,
                    userAgent: 'test',
                    appVersion: '1.0.0',
                    created: 1000,
                    lastActive: 1000,
                    profile: {
                        theme: 'light',
                        fontSize: 16,
                        ttsVoiceURI: null,
                        ttsRate: 1,
                        ttsPitch: 1
                    }
                }
            }
        });
    };

    /** Publish and report whether the devices map actually moved. */
    const publish = (spend: { day: string; rpd: number }): boolean => {
        const before = useDeviceStore.getState().devices;
        useDeviceStore.getState().publishEmbedSpend('device-self', spend);
        return useDeviceStore.getState().devices !== before;
    };

    it('50 same-day publishes of rpd+1 move the devices map only at step crossings', () => {
        seedSelf();

        const wroteAt: number[] = [];
        for (let rpd = 1; rpd <= 50; rpd++) {
            if (publish({ day: DAY, rpd })) wroteAt.push(rpd);
        }

        // First publish (no prior spend) + every crossing of the 10-request step.
        expect(wroteAt).toEqual([1, 11, 21, 31, 41]);
        // The stored figure is the last one written — coarse, never ahead.
        expect(useDeviceStore.getState().devices['device-self'].embedSpend).toEqual({ day: DAY, rpd: 41 });
    });

    it('a day rollover always writes, even when rpd is unchanged', () => {
        seedSelf();

        expect(publish({ day: DAY, rpd: 40 })).toBe(true);
        expect(publish({ day: DAY, rpd: 41 })).toBe(false);
        // Same rpd, new PT day: the reconciler ignores spend stamped with a
        // prior day, so this MUST be written through.
        expect(publish({ day: '2026-06-14', rpd: 41 })).toBe(true);
        expect(useDeviceStore.getState().devices['device-self'].embedSpend).toEqual({ day: '2026-06-14', rpd: 41 });
    });

    it('a reset to zero (a fresh counter) still writes', () => {
        seedSelf();

        expect(publish({ day: DAY, rpd: 200 })).toBe(true);
        // |0 - 200| >= the step, so a counter reset is never swallowed.
        expect(publish({ day: DAY, rpd: 0 })).toBe(true);
        expect(useDeviceStore.getState().devices['device-self'].embedSpend).toEqual({ day: DAY, rpd: 0 });
    });

    it('does not notify subscribers on a coalesced publish', () => {
        seedSelf();
        publish({ day: DAY, rpd: 1 });

        const listener = vi.fn();
        const unsubscribe = useDeviceStore.subscribe(listener);
        for (let rpd = 2; rpd <= 10; rpd++) {
            useDeviceStore.getState().publishEmbedSpend('device-self', { day: DAY, rpd });
        }
        expect(listener).not.toHaveBeenCalled();

        useDeviceStore.getState().publishEmbedSpend('device-self', { day: DAY, rpd: 11 });
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
    });
});
