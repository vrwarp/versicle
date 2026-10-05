/**
 * The "receives but never sends" repair (uploadMissingState) against the
 * REAL FirestoreBackend + vendored y-cinder, on the Firestore emulator.
 *
 * Field report: one device's edits stopped reaching every other device for
 * weeks while it kept receiving theirs; its write channel was healthy
 * (Write/channel 200, server acks). That is the signature of a GAP in the
 * device's clock range on the server: Yjs integrates a client's structs
 * strictly in clock order, so once one range is missing every later edit
 * of that client is parked in pendingStructs on every peer — silently.
 *
 * This suite manufactures such a gap with the real provider, proves a peer
 * parks the later edit, then runs the repair from the device that holds
 * the full history and proves the peer integrates everything.
 *
 * Rules are permissive under a dedicated project id (the system under test
 * is the sync algorithm, not firestore.rules). Auto-skips without the
 * emulator.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { FireProvider } from 'y-cinder';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  terminate,
  collection,
  getDocs,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

const emulatorState = vi.hoisted(() => ({
  app: null as import('firebase/app').FirebaseApp | null,
  db: null as import('firebase/firestore').Firestore | null,
}));

vi.mock('@lib/sync/firebase-config', () => ({
  getFirebaseApp: () => emulatorState.app,
  getFirestoreDb: () => emulatorState.db,
}));

import { FirestoreBackend } from '@domains/sync/backend/FirestoreBackend';
import { uploadMissingState } from '@domains/sync/core/uploadMissingState';

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';
const PROJECT_ID = 'demo-versicle-repair';
const UID = 'repair-user';

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

const reachable = (await emulatorReachable(FIRESTORE_HOST)) && (await emulatorReachable(STORAGE_HOST));

let appSeq = 0;
const apps: Array<{ app: FirebaseApp; db: Firestore }> = [];
const providers: FireProvider[] = [];

function newApp(): { app: FirebaseApp; db: Firestore } {
  const app = initializeApp(
    { projectId: PROJECT_ID, apiKey: 'fake-api-key', storageBucket: `${PROJECT_ID}.appspot.com` },
    `repair-${++appSeq}`
  );
  const db = getFirestore(app);
  const f = splitHostPort(FIRESTORE_HOST);
  connectFirestoreEmulator(db, f.host, f.port);
  const s = splitHostPort(STORAGE_HOST);
  connectStorageEmulator(getStorage(app), s.host, s.port);
  apps.push({ app, db });
  return { app, db };
}

function provide(app: FirebaseApp, doc: Y.Doc, path: string): FireProvider {
  const p = new FireProvider({ firebaseApp: app, ydoc: doc, path, maxWaitTime: 50, maxUpdatesThreshold: 1000 });
  providers.push(p);
  return p;
}

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const pending = (doc: Y.Doc): unknown =>
  (doc.store as unknown as { pendingStructs: unknown }).pendingStructs;

describe.skipIf(!reachable)('uploadMissingState — repairing a gap in the cloud copy (emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let seq = 0;
  const nextWorkspace = (): string => `ws_repair_${Date.now()}_${++seq}`;
  const pathOf = (ws: string): string => `users/${UID}/versicle/${ws}`;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules:
          "rules_version = '2'; service cloud.firestore { match /databases/{db}/documents { match /{p=**} { allow read, write: if true; } } }",
        ...splitHostPort(FIRESTORE_HOST),
      },
      storage: {
        rules:
          "rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{p=**} { allow read, write: if true; } } }",
        ...splitHostPort(STORAGE_HOST),
      },
    });
    const { app, db } = newApp();
    emulatorState.app = app;
    emulatorState.db = db;
  }, 30000);

  afterEach(async () => {
    for (const p of providers.splice(0)) await p.destroy().catch(() => undefined);
  });

  afterAll(async () => {
    for (const { app, db } of apps) {
      await terminate(db).catch(() => undefined);
      await deleteApp(app).catch(() => undefined);
    }
    await testEnv?.cleanup();
  });

  it('a peer parks edits past a gap; the repair from the full-history device heals it', async () => {
    const ws = nextWorkspace();
    const path = pathOf(ws);

    // "Android" saves three edits as three update documents...
    const android = new Y.Doc();
    const a1 = newApp();
    const androidProvider = provide(a1.app, android, path);
    await until(() => androidProvider.synced, 20000, 'android initial sync');
    const saved = (): Promise<void> => new Promise<void>((r) => androidProvider.once('saved', () => r()));
    android.getMap('annotations').set('note-1', { text: 'first' });
    await saved();
    android.getMap('annotations').set('note-2', { text: 'lost in transit' });
    await saved();
    android.getMap('library').set('book-from-android', { title: 'Android book' });
    await saved();
    await androidProvider.destroy();
    providers.splice(providers.indexOf(androidProvider), 1);

    // ...and the middle one is lost on the server (the gap).
    const updates = await getDocs(collection(a1.db, path, 'updates'));
    const byTime = updates.docs.sort(
      (x, y) => x.data().createdAt.toMillis() - y.data().createdAt.toMillis()
    );
    expect(byTime).toHaveLength(3);
    await deleteDoc(byTime[1].ref);

    // "Chrome": a peer downloading the cloud copy sees note-1 but parks the
    // Android book behind the gap — the field symptom.
    const chrome = new Y.Doc();
    const ch = newApp();
    provide(ch.app, chrome, path);
    await until(() => chrome.getMap('annotations').has('note-1'), 20000, 'chrome to receive note-1');
    expect(chrome.getMap('annotations').has('note-2')).toBe(false);
    expect(chrome.getMap('library').has('book-from-android')).toBe(false);
    expect(pending(chrome)).not.toBeNull();

    // The repair, run from the device that holds the full history.
    const result = await uploadMissingState(new FirestoreBackend(UID), ws, android, {
      maxWaitTimeMs: 50,
      timeoutMs: 20000,
    });
    expect(result).toMatchObject({ ok: true, uploaded: true });
    if (result.ok) {
      expect(result.clientsBehind).toEqual([
        expect.objectContaining({ client: android.clientID }),
      ]);
      expect(result.cloudPendingBefore).not.toBeNull();
      expect(result.cloudPendingAfter).toBeNull();
    }

    // Chrome integrates the gap AND everything that was parked behind it.
    await until(() => chrome.getMap('library').has('book-from-android'), 20000, 'chrome to integrate the parked book');
    expect(chrome.getMap('annotations').get('note-2')).toEqual({ text: 'lost in transit' });
    expect(pending(chrome)).toBeNull();
  }, 120000);

  it('is a no-op when the cloud already holds everything', async () => {
    const ws = nextWorkspace();
    const doc = new Y.Doc();
    const a = newApp();
    const p = provide(a.app, doc, pathOf(ws));
    await until(() => p.synced, 20000, 'initial sync');
    doc.getMap('library').set('b1', { title: 'x' });
    await new Promise<void>((r) => p.once('saved', () => r()));

    const result = await uploadMissingState(new FirestoreBackend(UID), ws, doc, {
      maxWaitTimeMs: 50,
      timeoutMs: 20000,
    });
    expect(result).toMatchObject({ ok: true, uploaded: false, bytes: 0, clientsBehind: [] });
  }, 60000);

  it('characterization: does a plain reconnect of the full-history device heal an updates-tier gap?', async () => {
    const ws = nextWorkspace();
    const path = pathOf(ws);
    const android = new Y.Doc();
    const a1 = newApp();
    let androidProvider = provide(a1.app, android, path);
    await until(() => androidProvider.synced, 20000, 'android initial sync');
    const saved = (): Promise<void> => new Promise<void>((r) => androidProvider.once('saved', () => r()));
    android.getMap('annotations').set('note-1', { text: 'first' });
    await saved();
    android.getMap('annotations').set('note-2', { text: 'lost in transit' });
    await saved();
    android.getMap('library').set('book-from-android', { title: 'Android book' });
    await saved();
    await androidProvider.destroy();
    providers.splice(providers.indexOf(androidProvider), 1);
    const updates = await getDocs(collection(a1.db, path, 'updates'));
    const byTime = updates.docs.sort((x, y) => x.data().createdAt.toMillis() - y.data().createdAt.toMillis());
    await deleteDoc(byTime[1].ref);

    const chrome = new Y.Doc();
    provide(newApp().app, chrome, path);
    await until(() => chrome.getMap('annotations').has('note-1'), 20000, 'chrome note-1');

    // "Relaunch": the same doc reconnects under a fresh provider + app.
    androidProvider = provide(newApp().app, android, path);
    await until(() => androidProvider.synced, 20000, 'android re-sync');

    // y-cinder's initial-sync coverage decodes the server's real ranges, so
    // a gap in the UPDATES tier is visible to it and the push refills it.
    await until(() => chrome.getMap('library').has('book-from-android'), 20000, 'reconnect to heal the gap');
    expect(pending(chrome)).toBeNull();
  }, 120000);
});
