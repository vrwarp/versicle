/**
 * SyncOrchestrator unit suite — ABSORBS FirestoreSyncManager.test.ts
 * (deleted with the manager in P4-3; test-absorption ledger, program rule
 * 8): the getters/subscription semantics, the real-path event wiring over a
 * mocked y-cinder FireProvider, the permission-denied surfacing regression,
 * and the workspace-switch checkpoint-pinning regression all land here with
 * their assertions unchanged.
 *
 * Unlike the legacy suite (which exercised the manager singleton over the
 * real stores), this constructs the orchestrator directly over injected
 * ports — the per-module shape §D2's decomposition exists for. The
 * composition-root singleton (getSyncOrchestrator) keeps its own pin below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createSyncOrchestrator, type SyncOrchestrator } from './SyncOrchestrator';
import type { SyncOrchestratorConfig, SyncOrchestratorDeps, SyncStatePort } from './ports';
import { FirestoreBackend } from '../backend/FirestoreBackend';
import { MigrationStateService } from '../workspaces/MigrationStateService';
import { getSyncEventBus } from '../events';
import { wireSyncEvents } from '@app/sync/wireSyncEvents';

// Mock firebase/auth
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
    signOut: vi.fn()
}));

// Store instances here for easier testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let latestFireProviderInstance: any = null;

// Mock y-cinder
vi.mock('y-cinder', () => ({
    FireProvider: vi.fn(function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listeners: Record<string, ((...args: any[]) => void)[]> = {};
        const instance = {
            destroy: vi.fn(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            on: vi.fn((event: string, cb: (...args: any[]) => void) => {
                if (!listeners[event]) listeners[event] = [];
                listeners[event].push(cb);
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            off: vi.fn((event: string, cb: (...args: any[]) => void) => {
                if (listeners[event]) {
                    listeners[event] = listeners[event].filter(c => c !== cb);
                }
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            emit: (event: string, ...args: any[]) => {
                const callbacks = listeners[event];
                if (callbacks) {
                    callbacks.forEach(cb => cb(...args));
                }
            }
        };
        latestFireProviderInstance = instance;
        return instance;
    })
}));

// Mock firebase-config (intercepts the alias and relative specifiers alike)
vi.mock('@lib/sync/firebase-config', () => ({
    isFirebaseConfigured: vi.fn(() => true),
    initializeFirebase: vi.fn(() => true),
    getFirebaseApp: vi.fn(() => ({})),
    getFirebaseAuth: vi.fn(() => ({})),
    getGoogleProvider: vi.fn(() => ({})),
    getFirestoreDb: vi.fn(() => ({}))
}));

// Mock firebase/firestore (FirestoreBackend's transport)
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
    setDoc: vi.fn(() => Promise.resolve()),
    collection: vi.fn(),
    getDocs: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
    query: vi.fn(),
    limit: vi.fn(),
    writeBatch: vi.fn(() => ({
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(() => Promise.resolve())
    }))
}));

describe('SyncOrchestrator', () => {
    let unwireSyncEvents: () => void;
    let testDoc: Y.Doc;
    let activeWorkspaceId: string | null;
    let syncState: SyncStatePort;
    let checkpointsPort: {
        createCheckpoint: ReturnType<typeof vi.fn<(trigger: string, options?: { protected?: boolean }) => Promise<number>>>;
        createAutomaticCheckpoint: ReturnType<typeof vi.fn<(trigger: string, intervalMs: number) => Promise<number | null>>>;
    };

    const makeOrchestrator = (
        config?: SyncOrchestratorConfig,
        overrides?: Partial<SyncOrchestratorDeps>
    ): SyncOrchestrator => {
        return createSyncOrchestrator({
            backendSelection: { factory: (uid) => new FirestoreBackend(uid) },
            // The process-wide bus: wireSyncEvents (registered below) pins
            // the SYSTEM behavior — transport emits SyncEvents, the app-side
            // subscriber maps them to user-facing copy.
            events: getSyncEventBus(),
            doc: () => testDoc,
            whenLocalSynced: () => Promise.resolve(),
            onObsolete: vi.fn(),
            currentSchemaVersion: 6,
            isCleanClient: () => true,
            isEnabled: () => true,
            debounceOverrideMs: () => 0,
            syncState,
            checkpoints: checkpointsPort,
            migrationState: MigrationStateService,
            config,
            ...overrides,
        });
    };

    beforeEach(async () => {
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });

        testDoc = new Y.Doc();
        activeWorkspaceId = null;
        syncState = {
            getActiveWorkspaceId: () => activeWorkspaceId,
            setActiveWorkspaceId: (id) => { activeWorkspaceId = id; },
            setFirebaseEnabled: vi.fn(),
        };
        checkpointsPort = {
            createCheckpoint: vi.fn(async () => 1),
            createAutomaticCheckpoint: vi.fn(async () => null),
        };
        MigrationStateService.clear();

        // The toast assertions below pin the SYSTEM behavior: transport
        // emits SyncEvents, the app-side subscriber (registered by the
        // syncInit boot task in production) maps them to user-facing copy.
        unwireSyncEvents = wireSyncEvents();
    });

    afterEach(() => {
        unwireSyncEvents();
        MigrationStateService.clear();
        testDoc.destroy();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe('regression: composition-root accessor is a singleton (was getInstance)', () => {
        it('should return a singleton instance until reset', async () => {
            const { getSyncOrchestrator, stopSyncForWipe } = await import('@app/sync/createSync');
            stopSyncForWipe();
            const instance1 = getSyncOrchestrator();
            const instance2 = getSyncOrchestrator();
            expect(instance1).toBe(instance2);
            stopSyncForWipe();
            expect(getSyncOrchestrator()).not.toBe(instance1);
            stopSyncForWipe();
        });
    });

    describe('construction', () => {
        it('should accept configuration', () => {
            const orchestrator = makeOrchestrator({
                maxWaitFirestoreTime: 3000,
                maxUpdatesThreshold: 100
            });
            expect(orchestrator).toBeDefined();
        });
    });

    describe('getStatus', () => {
        it('should return disconnected initially', () => {
            expect(makeOrchestrator().getStatus()).toBe('disconnected');
        });
    });

    describe('getAuthStatus', () => {
        it('should return loading initially', () => {
            expect(makeOrchestrator().getAuthStatus()).toBe('loading');
        });
    });

    describe('isSignedIn', () => {
        it('should return false when not signed in', () => {
            expect(makeOrchestrator().isSignedIn()).toBe(false);
        });
    });

    describe('isConnected', () => {
        it('should return false when not connected', () => {
            expect(makeOrchestrator().isConnected()).toBe(false);
        });
    });

    describe('getCurrentUser', () => {
        it('should return null when not signed in', () => {
            expect(makeOrchestrator().getCurrentUser()).toBeNull();
        });
    });

    describe('onStatusChange', () => {
        it('should immediately call callback with current status', () => {
            const callback = vi.fn();
            makeOrchestrator().onStatusChange(callback);
            expect(callback).toHaveBeenCalledWith('disconnected');
        });

        it('should return unsubscribe function', () => {
            const unsubscribe = makeOrchestrator().onStatusChange(vi.fn());
            expect(typeof unsubscribe).toBe('function');
            // Should not throw
            unsubscribe();
        });
    });

    describe('onAuthChange', () => {
        it('should immediately call callback with current auth status', () => {
            const callback = vi.fn();
            makeOrchestrator().onAuthChange(callback);
            expect(callback).toHaveBeenCalledWith('loading', null);
        });

        it('should return unsubscribe function', () => {
            const unsubscribe = makeOrchestrator().onAuthChange(vi.fn());
            expect(typeof unsubscribe).toBe('function');
            unsubscribe();
        });
    });

    describe('stop', () => {
        it('should not throw when called', () => {
            expect(() => makeOrchestrator().stop()).not.toThrow();
        });
    });

    describe('start (was initialization)', () => {
        it('should check for redirect result on start', async () => {
            const { getRedirectResult } = await import('firebase/auth');

            await makeOrchestrator().start();

            expect(getRedirectResult).toHaveBeenCalled();
        });

        it('should skip the auth session entirely when the enablement gate is off (§D2)', async () => {
            const { getRedirectResult } = await import('firebase/auth');

            const orchestrator = makeOrchestrator(undefined, { isEnabled: () => false });
            await orchestrator.start();

            expect(getRedirectResult).not.toHaveBeenCalled();
            expect(orchestrator.getAuthStatus()).toBe('signed-out');
        });

        it('should initialize FireProvider with mapped maxWaitTime', async () => {
            const { FireProvider } = await import('y-cinder');
            const { onAuthStateChanged } = await import('firebase/auth');

            // Mock auth state change to trigger connection
            vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
                // @ts-expect-error Mocking user
                callback({ uid: 'test-uid', email: 'test@example.com' });
                return () => { };
            });

            activeWorkspaceId = 'ws_test';
            const orchestrator = makeOrchestrator({ maxWaitFirestoreTime: 5000 });
            await orchestrator.start();

            await vi.waitFor(() => {
                expect(FireProvider).toHaveBeenCalledWith(expect.objectContaining({
                    maxWaitTime: 5000
                }));
            });
        });
    });

    describe('error events', () => {
        let orchestrator: SyncOrchestrator;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mockFireProviderInstance: any;

        beforeEach(async () => {
            const { onAuthStateChanged } = await import('firebase/auth');

            // Mock auth state change to trigger connection
            vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
                // @ts-expect-error Mocking user
                callback({ uid: 'test-uid', email: 'test@example.com' });
                return () => { };
            });

            activeWorkspaceId = 'ws_test';
            orchestrator = makeOrchestrator();
            await orchestrator.start();

            // Wait for internal connections to resolve
            await vi.waitFor(() => {
                expect(orchestrator.getStatus()).toBe('connected');
            });

            // Retrieve instance created during initialization
            mockFireProviderInstance = latestFireProviderInstance;
        });

        it('should handle connection-error by setting status to error', async () => {
            expect(orchestrator.getStatus()).toBe('connected');
            mockFireProviderInstance.emit('connection-error', { code: 'some-error', message: 'Test message', error: new Error('Test error') });
            expect(orchestrator.getStatus()).toBe('error');
        });

        it('should handle sync-failure by setting status and showing toast', async () => {
            const { useToastStore } = await import('@store/useToastStore');
            const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

            mockFireProviderInstance.emit('sync-failure', new Error('Test failure'));

            expect(orchestrator.getStatus()).toBe('error');
            expect(showToastMock).toHaveBeenCalledWith(
                'Sync failed after multiple attempts. Please check your connection.',
                'error',
                5000
            );
        });

        it('should handle save-rejected with document-too-large', async () => {
            const { useToastStore } = await import('@store/useToastStore');
            const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

            mockFireProviderInstance.emit('save-rejected', {
                code: 'document-too-large',
                sizeBytes: 2000000,
                error: new Error('Too large')
            });

            expect(orchestrator.getStatus()).toBe('error');
            expect(showToastMock).toHaveBeenCalledWith(
                'Sync disabled: Document too large (2000000 bytes). Please export and clear data.',
                'error',
                8000
            );
        });

        it('should handle save-rejected with max-retries-exceeded', async () => {
            const { useToastStore } = await import('@store/useToastStore');
            const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

            mockFireProviderInstance.emit('save-rejected', {
                code: 'max-retries-exceeded',
                error: new Error('Timeout')
            });

            expect(orchestrator.getStatus()).toBe('error');
            expect(showToastMock).toHaveBeenCalledWith(
                'Sync save failed: Max retries exceeded. Check connection.',
                'error',
                5000
            );
        });

        describe('regression: permission-denied surfaces a "rules out of date" hint (BYO-Firebase lockout)', () => {
            const permissionDeniedError = () =>
                Object.assign(new Error('Missing or insufficient permissions.'), {
                    code: 'permission-denied'
                });

            it('should show the rules hint when save-rejected wraps a permission-denied error', async () => {
                const { RULES_OUT_OF_DATE_MESSAGE } = await import('../backend/permissionDenied');
                const { useToastStore } = await import('@store/useToastStore');
                const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

                mockFireProviderInstance.emit('save-rejected', {
                    code: 'max-retries-exceeded',
                    retries: 5,
                    error: permissionDeniedError()
                });

                expect(orchestrator.getStatus()).toBe('error');
                expect(showToastMock).toHaveBeenCalledWith(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
            });

            it('should show the rules hint when sync-failure wraps a permission-denied error', async () => {
                const { RULES_OUT_OF_DATE_MESSAGE } = await import('../backend/permissionDenied');
                const { useToastStore } = await import('@store/useToastStore');
                const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

                mockFireProviderInstance.emit('sync-failure', permissionDeniedError());

                expect(orchestrator.getStatus()).toBe('error');
                expect(showToastMock).toHaveBeenCalledWith(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
            });

            it('should show the rules hint when connection-error wraps a permission-denied error', async () => {
                const { RULES_OUT_OF_DATE_MESSAGE } = await import('../backend/permissionDenied');
                const { useToastStore } = await import('@store/useToastStore');
                const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

                mockFireProviderInstance.emit('connection-error', {
                    code: 'listener-error',
                    message: 'Listener failed',
                    error: permissionDeniedError()
                });

                expect(orchestrator.getStatus()).toBe('error');
                expect(showToastMock).toHaveBeenCalledWith(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
            });

            it('should keep the generic message for non-permission failures', async () => {
                const { useToastStore } = await import('@store/useToastStore');
                const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

                mockFireProviderInstance.emit('sync-failure', new Error('Network flake'));

                expect(showToastMock).toHaveBeenCalledWith(
                    'Sync failed after multiple attempts. Please check your connection.',
                    'error',
                    5000
                );
            });
        });
    });

    describe('regression: workspace switch pins the pre-migration checkpoint', () => {
        let orchestrator: SyncOrchestrator;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mainProvider: any;

        beforeEach(async () => {
            const { onAuthStateChanged } = await import('firebase/auth');

            // Mock auth state change to trigger connection
            vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
                // @ts-expect-error Mocking user
                callback({ uid: 'test-uid', email: 'test@example.com' });
                return () => { };
            });

            checkpointsPort.createCheckpoint.mockResolvedValue(7);

            activeWorkspaceId = 'ws_current';
            orchestrator = makeOrchestrator();
            await orchestrator.start();

            await vi.waitFor(() => {
                expect(orchestrator.getStatus()).toBe('connected');
            });
            mainProvider = latestFireProviderInstance;
        });

        afterEach(() => {
            MigrationStateService.clear();
        });

        // Drives the temp workspace-download provider to completion.
        const completeRemoteDownload = async () => {
            await vi.waitFor(() => {
                expect(latestFireProviderInstance).not.toBe(mainProvider);
            });
            latestFireProviderInstance.emit('sync', true);
        };

        it('creates the pre-migration checkpoint with protected: true', async () => {
            const switchPromise = orchestrator.switchWorkspace('ws_target');
            await completeRemoteDownload();
            await switchPromise;

            expect(checkpointsPort.createCheckpoint).toHaveBeenCalledWith('pre-migration', { protected: true });
            // The state machine references the pinned backup across the
            // reload. Since P4-5 the switch commits STAGED (the boot
            // interceptor's idempotent apply performs the destructive step
            // and the AWAITING_CONFIRMATION transition — pinned by
            // stagedSwap.test.ts and App_Boot.test.tsx); the protected
            // backup id rides the state machine exactly as before.
            expect(MigrationStateService.getState()).toEqual({
                status: 'STAGED',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 7,
                previousWorkspaceId: 'ws_current'
            });
        });

        // The destructive-apply failure row ("rolls back to the pinned
        // backup instead of clearing state") moved with the destructive
        // apply itself: the boot interceptor routes a failed staged apply
        // to RESTORING_BACKUP (App_Boot.test.tsx) and the apply's
        // validate-before-destroy rows live in stagedSwap.test.ts.
    });
});
