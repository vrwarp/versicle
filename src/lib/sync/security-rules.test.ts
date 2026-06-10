/**
 * Security-rules suite for the repo-root `firestore.rules` and `storage.rules`
 * (the BYO-Firebase deploy artifacts, wired up in `firebase.json`).
 *
 * These tests run against the Firebase emulator and auto-skip when no emulator
 * is reachable, so the default `npx vitest run` stays green.
 *
 * How to run with the emulator (requires Java):
 *
 *   npx firebase-tools emulators:exec --only firestore,storage,auth \
 *     --project demo-versicle-rules \
 *     "npx vitest run src/lib/sync/security-rules.test.ts"
 *
 * or start it in another terminal and run vitest normally:
 *
 *   npx firebase-tools emulators:start --only firestore,storage,auth \
 *     --project demo-versicle-rules
 *   npx vitest run src/lib/sync/security-rules.test.ts
 *
 * Runs in the node environment (pragma below): the Firebase SDK's emulator
 * transports are unreliable under jsdom's XMLHttpRequest.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

// vitest runs from the repo root (where vitest.config.ts lives).
const FIRESTORE_RULES_PATH = resolve(process.cwd(), 'firestore.rules');
const STORAGE_RULES_PATH = resolve(process.cwd(), 'storage.rules');

// Ports match firebase.json; emulators:exec overrides via env vars.
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';

function splitHostPort(hostPort: string): { host: string; port: number } {
    const idx = hostPort.lastIndexOf(':');
    return { host: hostPort.slice(0, idx), port: Number(hostPort.slice(idx + 1)) };
}

async function emulatorReachable(hostPort: string): Promise<boolean> {
    try {
        await fetch(`http://${hostPort}/`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

const [firestoreEmulatorUp, storageEmulatorUp] = await Promise.all([
    emulatorReachable(FIRESTORE_HOST),
    emulatorReachable(STORAGE_HOST)
]);
const emulatorsUp = firestoreEmulatorUp && storageEmulatorUp;

const OWNER = 'owner-uid';
const STRANGER = 'stranger-uid';
const WS = 'ws_test';
const ROOT_DOC = `users/${OWNER}/versicle/${WS}`;
const META_DOC = `users/${OWNER}/workspaces/${WS}`;

describe.skipIf(!emulatorsUp)('security rules (firebase emulator)', () => {
    let testEnv: RulesTestEnvironment;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-versicle-rules',
            firestore: {
                rules: readFileSync(FIRESTORE_RULES_PATH, 'utf8'),
                ...splitHostPort(FIRESTORE_HOST)
            },
            storage: {
                rules: readFileSync(STORAGE_RULES_PATH, 'utf8'),
                ...splitHostPort(STORAGE_HOST)
            }
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.clearStorage();
    });

    const firestoreAs = (uid?: string) =>
        uid ? testEnv.authenticatedContext(uid).firestore() : testEnv.unauthenticatedContext().firestore();
    const storageAs = (uid?: string) =>
        uid ? testEnv.authenticatedContext(uid).storage() : testEnv.unauthenticatedContext().storage();

    /** Seeds a tombstoned workspace (plus one residual update doc) bypassing rules. */
    const seedTombstonedWorkspace = () =>
        testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx.firestore().doc(ROOT_DOC).set({ isDeleted: true, deletedAt: 1111 });
            await ctx.firestore().doc(`${ROOT_DOC}/updates/u1`).set({ update: 'residual' });
        });

    describe('firestore.rules: owner-scoped access', () => {
        it('owner can read and write the workspace root doc', async () => {
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(ROOT_DOC).set({ version: 1 }));
            await assertSucceeds(db.doc(ROOT_DOC).get());
        });

        it('owner can read and write the workspace metadata index', async () => {
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(META_DOC).set({ workspaceId: WS, name: 'My Library', createdAt: 1 }));
            await assertSucceeds(db.collection(`users/${OWNER}/workspaces`).get());
        });

        it('owner can write to every y-cinder subcollection of a live workspace', async () => {
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(ROOT_DOC).set({ version: 1 }));
            await assertSucceeds(db.collection(`${ROOT_DOC}/updates`).add({ update: 'blob', createdBy: OWNER }));
            await assertSucceeds(db.doc(`${ROOT_DOC}/history/h1`).set({ startTime: 1 }));
            await assertSucceeds(db.doc(`${ROOT_DOC}/maintenance/skew_1`).set({ t: 1 }));
            await assertSucceeds(db.doc(`${ROOT_DOC}/metadata/lock_compaction`).set({ owner: OWNER, createdAt: 1 }));
            await assertSucceeds(db.doc(`${ROOT_DOC}/metadata/lock_compaction`).delete());
        });

        it('non-owner is denied read and write everywhere', async () => {
            await testEnv.withSecurityRulesDisabled(async (ctx) => {
                await ctx.firestore().doc(ROOT_DOC).set({ version: 1 });
            });
            const db = firestoreAs(STRANGER);
            await assertFails(db.doc(ROOT_DOC).get());
            await assertFails(db.doc(ROOT_DOC).set({ version: 2 }));
            await assertFails(db.collection(`${ROOT_DOC}/updates`).add({ update: 'x' }));
            await assertFails(db.doc(META_DOC).get());
            await assertFails(db.doc(META_DOC).set({ name: 'hijack' }));
        });

        it('unauthenticated access is denied', async () => {
            const db = firestoreAs();
            await assertFails(db.doc(ROOT_DOC).get());
            await assertFails(db.doc(ROOT_DOC).set({ version: 1 }));
        });

        it('owner-scoped catch-all covers other collections without touching versicle paths', async () => {
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(`users/${OWNER}/preferences/general`).set({ theme: 'dark' }));
            await assertFails(firestoreAs(STRANGER).doc(`users/${OWNER}/preferences/general`).get());
        });
    });

    describe('firestore.rules: regression: tombstone write-denial is not neutered by a catch-all', () => {
        it('owner can plant a tombstone on a live workspace', async () => {
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(ROOT_DOC).set({ version: 1 }));
            await assertSucceeds(db.doc(ROOT_DOC).set({ isDeleted: true, deletedAt: 1111 }, { merge: true }));
        });

        it('re-asserting the tombstone (idempotent deleteWorkspace retry) stays allowed', async () => {
            await seedTombstonedWorkspace();
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(ROOT_DOC).set({ isDeleted: true, deletedAt: 2222 }, { merge: true }));
        });

        it('denies data writes to a tombstoned root doc (compaction-style merge)', async () => {
            await seedTombstonedWorkspace();
            const db = firestoreAs(OWNER);
            await assertFails(
                db.doc(ROOT_DOC).set({ snapshotStoragePath: 'x', version: 2 }, { merge: true })
            );
        });

        it('denies resurrecting a tombstoned workspace', async () => {
            await seedTombstonedWorkspace();
            const db = firestoreAs(OWNER);
            await assertFails(db.doc(ROOT_DOC).set({ isDeleted: false }, { merge: true }));
            await assertFails(db.doc(ROOT_DOC).delete());
        });

        it('denies new updates/history/maintenance/lock writes into a tombstoned workspace', async () => {
            await seedTombstonedWorkspace();
            const db = firestoreAs(OWNER);
            await assertFails(db.collection(`${ROOT_DOC}/updates`).add({ update: 'zombie' }));
            await assertFails(db.doc(`${ROOT_DOC}/history/h1`).set({ startTime: 1 }));
            await assertFails(db.doc(`${ROOT_DOC}/maintenance/skew_1`).set({ t: 1 }));
            await assertFails(db.doc(`${ROOT_DOC}/metadata/lock_compaction`).set({ owner: OWNER }));
        });

        it('still allows the owner to clean up residual docs in a tombstoned workspace', async () => {
            await seedTombstonedWorkspace();
            const db = firestoreAs(OWNER);
            await assertSucceeds(db.doc(`${ROOT_DOC}/updates/u1`).delete());
        });
    });

    describe('storage.rules: workspace snapshot blobs are owner-scoped', () => {
        const SNAPSHOT_PATH = `users/${OWNER}/versicle/${WS}/snapshot_v1.bin`;
        const LARGE_UPDATE_PATH = `users/${OWNER}/versicle/${WS}/large_updates/${OWNER}_1.bin`;
        const bytes = new Uint8Array([1, 2, 3, 4]);

        it('owner can upload, read, and delete snapshot blobs', async () => {
            const storage = storageAs(OWNER);
            await assertSucceeds(storage.ref(SNAPSHOT_PATH).put(bytes).then());
            await assertSucceeds(storage.ref(LARGE_UPDATE_PATH).put(bytes).then());
            await assertSucceeds(storage.ref(SNAPSHOT_PATH).getDownloadURL());
            await assertSucceeds(storage.ref(SNAPSHOT_PATH).delete());
        });

        it('non-owner cannot read or write another user\'s blobs', async () => {
            await testEnv.withSecurityRulesDisabled(async (ctx) => {
                await ctx.storage().ref(SNAPSHOT_PATH).put(bytes).then();
            });
            const storage = storageAs(STRANGER);
            await assertFails(storage.ref(SNAPSHOT_PATH).getDownloadURL());
            await assertFails(storage.ref(SNAPSHOT_PATH).put(bytes).then());
            await assertFails(storage.ref(SNAPSHOT_PATH).delete());
        });

        it('unauthenticated access is denied', async () => {
            const storage = storageAs();
            await assertFails(storage.ref(SNAPSHOT_PATH).put(bytes).then());
            await assertFails(storage.ref(SNAPSHOT_PATH).getDownloadURL());
        });
    });
});
