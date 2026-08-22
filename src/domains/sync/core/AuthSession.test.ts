/**
 * `AuthSession` unit suite — the auth half of the strangled
 * FirestoreSyncManager (§D2).
 *
 * Every collaborator is a port or a mocked module, so the four `start()`
 * arms (mock session / unconfigured / init failure / no Auth instance), the
 * status fan-out to both subscribers and the typed `auth` event, and the
 * `getCurrentUser` fallback chain are each asserted in isolation — the
 * orchestrator suites only ever exercise the happy arm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from 'firebase/auth';
import type { FirebaseAuthStatus } from '~types/sync';
import type { SyncEvent } from '../events';
import { AuthSession } from './AuthSession';

const onAuthStateChanged = vi.fn();
const isFirebaseConfigured = vi.fn(() => true);
const initializeFirebase = vi.fn(() => true);
const getFirebaseAuth = vi.fn<() => unknown>(() => ({ currentUser: null }));
const signInWithGoogle = vi.fn<() => Promise<unknown>>(async () => undefined);
const signOutWithGoogle = vi.fn<(auth: unknown) => Promise<void>>(async () => undefined);

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
}));

vi.mock('@lib/sync/firebase-config', () => ({
  isFirebaseConfigured: () => isFirebaseConfigured(),
  initializeFirebase: () => initializeFirebase(),
  getFirebaseAuth: () => getFirebaseAuth(),
}));

vi.mock('@lib/sync/auth-helper', () => ({
  signInWithGoogle: () => signInWithGoogle(),
  signOutWithGoogle: (auth: unknown) => signOutWithGoogle(auth),
}));

const asUser = (uid: string, email: string | null): User => ({ uid, email }) as User;

let events: SyncEvent[];
let mockSession: { uid: string; email: string } | undefined;
let infoLogs: string[];
let warnLogs: string[];
let errorLogs: unknown[][];

const makeSession = (): AuthSession =>
  new AuthSession({
    events: {
      emit: (e) => {
        events.push(e);
      },
      on: () => () => undefined,
    },
    getMockSession: () => mockSession,
  });

beforeEach(() => {
  events = [];
  mockSession = undefined;
  infoLogs = [];
  warnLogs = [];
  errorLogs = [];
  onAuthStateChanged.mockReset().mockReturnValue(() => undefined);
  isFirebaseConfigured.mockReset().mockReturnValue(true);
  initializeFirebase.mockReset().mockReturnValue(true);
  getFirebaseAuth.mockReset().mockReturnValue({ currentUser: null });
  signInWithGoogle.mockReset().mockResolvedValue(undefined);
  signOutWithGoogle.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => {
    infoLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warnLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errorLogs.push(a);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthSession.start — the mock-session arm', () => {
  it('synthesizes the user from the injected session and never touches Firebase', async () => {
    mockSession = { uid: 'mock-user', email: 'mock@example.com' };
    const seen: Array<User | null> = [];
    const session = makeSession();

    await session.start((u) => seen.push(u));

    expect(seen).toEqual([{ uid: 'mock-user', email: 'mock@example.com' }]);
    expect(isFirebaseConfigured).not.toHaveBeenCalled();
    expect(onAuthStateChanged).not.toHaveBeenCalled();
    expect(infoLogs.some((l) => l.includes('Mock backend selected'))).toBe(true);
    // The mock arm reports nothing on the bus: the orchestrator's handler does.
    expect(events).toEqual([]);
  });

  it('re-reads the session on every start (the composition root can swap it)', async () => {
    const seen: Array<User | null> = [];
    const session = makeSession();

    mockSession = { uid: 'a', email: 'a@x' };
    await session.start((u) => seen.push(u));
    mockSession = { uid: 'b', email: 'b@x' };
    await session.start((u) => seen.push(u));

    expect(seen.map((u) => u?.uid)).toEqual(['a', 'b']);
  });
});

describe('AuthSession.start — the Firebase arms', () => {
  it('reports signed-out and stops when Firebase is not configured', async () => {
    isFirebaseConfigured.mockReturnValue(false);
    const session = makeSession();

    await session.start(() => undefined);

    expect(session.getAuthStatus()).toBe('signed-out');
    expect(initializeFirebase).not.toHaveBeenCalled();
    expect(onAuthStateChanged).not.toHaveBeenCalled();
    expect(warnLogs.some((l) => l.includes('Firebase not configured'))).toBe(true);
  });

  it('reports signed-out and stops when initialization fails', async () => {
    initializeFirebase.mockReturnValue(false);
    const session = makeSession();

    await session.start(() => undefined);

    expect(session.getAuthStatus()).toBe('signed-out');
    expect(getFirebaseAuth).not.toHaveBeenCalled();
    expect(
      errorLogs.some((a) => a.some((x) => String(x).includes('Firebase initialization failed')))
    ).toBe(true);
  });

  it('reports signed-out and stops when the Auth instance is missing', async () => {
    getFirebaseAuth.mockReturnValue(null);
    const session = makeSession();

    await session.start(() => undefined);

    expect(session.getAuthStatus()).toBe('signed-out');
    expect(onAuthStateChanged).not.toHaveBeenCalled();
    expect(
      errorLogs.some((a) => a.some((x) => String(x).includes('Firebase Auth not available')))
    ).toBe(true);
  });

  it('registers the auth listener against the live Auth instance and pipes users through', async () => {
    const auth = { currentUser: null };
    getFirebaseAuth.mockReturnValue(auth);
    const seen: Array<User | null> = [];
    const session = makeSession();

    await session.start((u) => seen.push(u));

    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(onAuthStateChanged.mock.calls[0][0]).toBe(auth);
    const listener = onAuthStateChanged.mock.calls[0][1] as (u: User | null) => void;
    listener(asUser('u1', 'u1@x'));
    listener(null);
    expect(seen).toEqual([{ uid: 'u1', email: 'u1@x' }, null]);
  });

  it('a RESTART detaches the previous listener before registering the next', async () => {
    const unsubscribe = vi.fn();
    onAuthStateChanged.mockReturnValue(unsubscribe);
    const session = makeSession();

    await session.start(() => undefined);
    expect(unsubscribe).not.toHaveBeenCalled();

    await session.start(() => undefined);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onAuthStateChanged).toHaveBeenCalledTimes(2);
  });
});

describe('AuthSession status fan-out', () => {
  it('starts as loading', () => {
    expect(makeSession().getAuthStatus()).toBe('loading');
  });

  it('publishes each status to subscribers AND to the typed bus, with the current email', () => {
    const session = makeSession();
    session.noteUser(asUser('u1', 'reader@example.com'));
    const seen: Array<[FirebaseAuthStatus, string | null]> = [];
    session.onAuthChange((status, user) => seen.push([status, user?.email ?? null]));
    seen.length = 0;
    events.length = 0;

    session.setAuthStatus('signed-in');

    expect(seen).toEqual([['signed-in', 'reader@example.com']]);
    expect(events).toEqual([
      { type: 'auth', status: 'signed-in', email: 'reader@example.com' },
    ]);
    expect(session.getAuthStatus()).toBe('signed-in');
  });

  it('reports a null email when no user has been noted', () => {
    const session = makeSession();

    session.setAuthStatus('signed-out');

    expect(events).toEqual([{ type: 'auth', status: 'signed-out', email: null }]);
  });

  it('reports a null email for a user that has none', () => {
    const session = makeSession();
    session.noteUser(asUser('anon', null));

    session.setAuthStatus('signed-in');

    expect(events).toEqual([{ type: 'auth', status: 'signed-in', email: null }]);
  });

  it('fires a new subscriber IMMEDIATELY with the current status and user', () => {
    const session = makeSession();
    session.noteUser(asUser('u1', 'u1@x'));
    session.setAuthStatus('signed-in');
    const seen: Array<[FirebaseAuthStatus, string | undefined]> = [];

    session.onAuthChange((status, user) => seen.push([status, user?.uid]));

    expect(seen).toEqual([['signed-in', 'u1']]);
  });

  it('the returned handle unsubscribes', () => {
    const session = makeSession();
    const seen: FirebaseAuthStatus[] = [];
    const off = session.onAuthChange((s) => seen.push(s));
    seen.length = 0;

    off();
    session.setAuthStatus('signed-in');

    expect(seen).toEqual([]);
    // The bus still gets it — unsubscribing one listener is not a mute.
    expect(events.some((e) => e.type === 'auth')).toBe(true);
  });

  it('notifies every subscriber', () => {
    const session = makeSession();
    const a: FirebaseAuthStatus[] = [];
    const b: FirebaseAuthStatus[] = [];
    session.onAuthChange((s) => a.push(s));
    session.onAuthChange((s) => b.push(s));

    session.setAuthStatus('signed-in');

    expect(a.at(-1)).toBe('signed-in');
    expect(b.at(-1)).toBe('signed-in');
  });
});

describe('AuthSession.getCurrentUser — the fallback chain', () => {
  it('returns the noted user first', () => {
    const session = makeSession();
    const user = asUser('noted', 'noted@x');
    session.noteUser(user);

    expect(session.getCurrentUser()).toBe(user);
    expect(getFirebaseAuth).not.toHaveBeenCalled();
  });

  it('synthesizes and CACHES the mock user when nothing was noted (HMR recovery)', () => {
    mockSession = { uid: 'mock-user', email: 'mock@x' };
    const session = makeSession();

    const first = session.getCurrentUser();

    expect(first).toEqual({ uid: 'mock-user', email: 'mock@x' });
    mockSession = undefined;
    expect(session.getCurrentUser()).toBe(first);
  });

  it("falls back to Firebase's currentUser and caches it", () => {
    const live = asUser('live', 'live@x');
    getFirebaseAuth.mockReturnValue({ currentUser: live });
    const session = makeSession();

    expect(session.getCurrentUser()).toBe(live);
    getFirebaseAuth.mockReturnValue(null);
    expect(session.getCurrentUser()).toBe(live);
  });

  it('returns null when Firebase has no signed-in user', () => {
    getFirebaseAuth.mockReturnValue({ currentUser: null });

    expect(makeSession().getCurrentUser()).toBeNull();
  });

  it('swallows a throwing getFirebaseAuth (Firebase not initialized yet)', () => {
    getFirebaseAuth.mockImplementation(() => {
      throw new Error('not initialized');
    });

    expect(makeSession().getCurrentUser()).toBeNull();
  });
});

describe('AuthSession.signIn', () => {
  it('reports loading, then leaves the status to the auth listener on success', async () => {
    signInWithGoogle.mockResolvedValue({ user: {} });
    const session = makeSession();

    await session.signIn();

    expect(events.map((e) => (e as { status: string }).status)).toEqual(['loading']);
  });

  it('handles the web (void) flow the same way', async () => {
    signInWithGoogle.mockResolvedValue(undefined);
    const session = makeSession();

    await session.signIn();

    expect(events.map((e) => (e as { status: string }).status)).toEqual(['loading']);
  });

  it('rewinds to signed-out and rethrows on failure', async () => {
    const boom = new Error('popup closed');
    signInWithGoogle.mockRejectedValue(boom);
    const session = makeSession();

    await expect(session.signIn()).rejects.toThrow('popup closed');

    expect(events.map((e) => (e as { status: string }).status)).toEqual(['loading', 'signed-out']);
    expect(session.getAuthStatus()).toBe('signed-out');
    expect(
      errorLogs.some((a) => a.some((x) => String(x).includes('Sign in failed')) && a.includes(boom))
    ).toBe(true);
  });
});

describe('AuthSession.signOut', () => {
  it('signs out against the live Auth instance', async () => {
    const auth = { currentUser: asUser('u1', 'u1@x') };
    getFirebaseAuth.mockReturnValue(auth);

    await makeSession().signOut();

    expect(signOutWithGoogle).toHaveBeenCalledWith(auth);
  });

  it('refuses when Firebase Auth was never initialized', async () => {
    getFirebaseAuth.mockReturnValue(null);

    await expect(makeSession().signOut()).rejects.toThrow('Firebase Auth not initialized');
    expect(signOutWithGoogle).not.toHaveBeenCalled();
  });

  it('logs and rethrows a failed sign-out', async () => {
    const boom = new Error('network');
    signOutWithGoogle.mockRejectedValue(boom);

    await expect(makeSession().signOut()).rejects.toThrow('network');

    expect(
      errorLogs.some((a) => a.some((x) => String(x).includes('Sign out failed')) && a.includes(boom))
    ).toBe(true);
  });
});

describe('AuthSession.stop', () => {
  it('detaches the auth listener and drops every subscriber', async () => {
    const unsubscribe = vi.fn();
    onAuthStateChanged.mockReturnValue(unsubscribe);
    const session = makeSession();
    await session.start(() => undefined);
    const seen: FirebaseAuthStatus[] = [];
    session.onAuthChange((s) => seen.push(s));
    seen.length = 0;

    session.stop();
    session.setAuthStatus('signed-out');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it('is safe before any start', () => {
    expect(() => makeSession().stop()).not.toThrow();
  });

  it('does not re-run the unsubscribe on a second stop', async () => {
    const unsubscribe = vi.fn();
    onAuthStateChanged.mockReturnValue(unsubscribe);
    const session = makeSession();
    await session.start(() => undefined);

    session.stop();
    session.stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
