/**
 * `AuthSession` — the auth half of the legacy FirestoreSyncManager
 * (phase4-sync-strangler.md §D2): firebase-config init, the
 * `onAuthStateChanged` listener, redirect-result handling, signIn/signOut,
 * and the auth-status fan-out (callbacks + the typed `auth` SyncEvent).
 *
 * The legacy `getRedirectResult` block was DELETED in P9 (the P4
 * §Follow-ups item 2 decision). Evidence of deadness: no module in the
 * production graph ever calls `signInWithRedirect` /`linkWithRedirect`/
 * `reauthenticateWithRedirect` (the only `signInWithRedirect` token in the
 * repo was this suite's firebase/auth MOCK), and per Firebase SDK
 * semantics `getRedirectResult` resolves null unless THIS app initiated a
 * redirect operation — the live sign-in path is SocialLogin →
 * `signInWithCredential` (auth-helper via GoogleAuthClient.connect
 * ('identity'), all platforms). The `signed-in-via-redirect` SyncEvent
 * died with it.
 *
 * Mock sessions: the composition root installs `mockSession` with the mock
 * backend; this module synthesizes the user instead of touching Firebase
 * (the legacy `initialize()` / `getCurrentUser()` mock branches).
 */
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import {
  getFirebaseAuth,
  isFirebaseConfigured,
  initializeFirebase,
} from '@lib/sync/firebase-config';
import { signInWithGoogle, signOutWithGoogle } from '@lib/sync/auth-helper';
import { createLogger } from '@lib/logger';
import type { FirebaseAuthStatus } from '~types/sync';
import type { SyncEventBus } from '../events';

const logger = createLogger('AuthSession');

export type AuthChangeCallback = (status: FirebaseAuthStatus, user: User | null) => void;

export interface AuthSessionDeps {
  events: SyncEventBus;
  /** Live read — the selection can be swapped by the composition root. */
  getMockSession: () => { uid: string; email: string } | undefined;
}

export class AuthSession {
  private currentUser: User | null = null;
  private authStatus: FirebaseAuthStatus = 'loading';
  private unsubscribeAuth: (() => void) | null = null;
  private authCallbacks: Set<AuthChangeCallback> = new Set();

  constructor(private readonly deps: AuthSessionDeps) {}

  /**
   * Start (or restart) the auth session. Re-runnable: settings-driven
   * enablement re-initializes without a reload (useFirestoreSync effect).
   *
   * `onUser` is the orchestrator's handleAuthStateChange — invoked for the
   * synthesized mock user immediately, or by `onAuthStateChanged` for real
   * Firebase auth. NOT awaited for the mock path (legacy parity: the
   * routing/connect chain runs detached; pinned debt, prep doc item 17).
   */
  async start(onUser: (user: User | null) => void): Promise<void> {
    // Mock backend selected (E2E/dev): simulate auth and connect.
    const mockSession = this.deps.getMockSession();
    if (mockSession) {
      logger.info('Mock backend selected. Simulating auth and connection.');
      const mockUser = { uid: mockSession.uid, email: mockSession.email } as User;
      void onUser(mockUser);
      return;
    }

    if (!isFirebaseConfigured()) {
      logger.warn('Firebase not configured. Sync disabled.');
      this.setAuthStatus('signed-out');
      return;
    }

    if (!initializeFirebase()) {
      logger.error('Firebase initialization failed.');
      this.setAuthStatus('signed-out');
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      logger.error('Firebase Auth not available.');
      this.setAuthStatus('signed-out');
      return;
    }

    // Set up auth state listener
    if (this.unsubscribeAuth) this.unsubscribeAuth();
    this.unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      onUser(user);
    });

    logger.debug('Auth session initialized');
  }

  /** Record the user delivered to the orchestrator's auth handler. */
  noteUser(user: User | null): void {
    this.currentUser = user;
  }

  setAuthStatus(status: FirebaseAuthStatus): void {
    this.authStatus = status;
    this.authCallbacks.forEach((cb) => cb(status, this.currentUser));
    this.deps.events.emit({
      type: 'auth',
      status,
      email: this.currentUser?.email ?? null,
    });
  }

  getAuthStatus(): FirebaseAuthStatus {
    return this.authStatus;
  }

  getCurrentUser(): User | null {
    if (this.currentUser) return this.currentUser;

    // Fallback for HMR / Dev mode where singleton state might be lost
    const mockSession = this.deps.getMockSession();
    if (mockSession) {
      this.currentUser = { uid: mockSession.uid, email: mockSession.email } as User;
      return this.currentUser;
    }

    try {
      const auth = getFirebaseAuth();
      if (auth?.currentUser) {
        this.currentUser = auth.currentUser;
        return this.currentUser;
      }
    } catch {
      // Ignore if Firebase isn't initialized yet
    }

    return null;
  }

  /** Subscribe to auth status changes; fires immediately with the current. */
  onAuthChange(callback: AuthChangeCallback): () => void {
    this.authCallbacks.add(callback);
    callback(this.authStatus, this.currentUser);
    return () => this.authCallbacks.delete(callback);
  }

  async signIn(): Promise<void> {
    try {
      this.setAuthStatus('loading');
      const result = await signInWithGoogle();

      if (result) {
        // Native flow returns a credential
        logger.debug('Sign in returned credential (Native flow)');
      } else {
        // Web flow returns void (redirecting)
        logger.debug('Sign in redirected (Web flow)');
      }
    } catch (error) {
      logger.error('Sign in failed:', error);
      this.setAuthStatus('signed-out');
      throw error;
    }
  }

  async signOut(): Promise<void> {
    const auth = getFirebaseAuth();
    if (!auth) {
      throw new Error('Firebase Auth not initialized');
    }

    try {
      await signOutWithGoogle(auth);
      // Auth state change handler will disconnect the provider
    } catch (error) {
      logger.error('Sign out failed:', error);
      throw error;
    }
  }

  /** Detach the auth listener and drop subscribers. */
  stop(): void {
    if (this.unsubscribeAuth) {
      this.unsubscribeAuth();
      this.unsubscribeAuth = null;
    }
    this.authCallbacks.clear();
  }
}
