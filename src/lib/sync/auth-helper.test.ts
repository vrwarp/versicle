import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';

const mocks = vi.hoisted(() => ({
    disconnect: vi.fn(),
    reset: vi.fn(),
    connectedServices: ['drive', 'genai'] as string[],
    firebaseSignOut: vi.fn(),
    socialLogout: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
    GoogleAuthProvider: { credential: vi.fn() },
    signInWithCredential: vi.fn(),
    signOut: mocks.firebaseSignOut,
}));
vi.mock('@capgo/capacitor-social-login', () => ({
    SocialLogin: { logout: mocks.socialLogout },
}));
vi.mock('./firebase-config', () => ({ getFirebaseAuth: vi.fn() }));
vi.mock('@domains/google', () => ({
    getGoogleAuthClient: () => ({ disconnect: mocks.disconnect }),
    GOOGLE_SERVICES: { drive: {}, genai: {} },
}));
vi.mock('@store/useGoogleServicesStore', () => ({
    useGoogleServicesStore: {
        getState: () => ({ connectedServices: mocks.connectedServices, reset: mocks.reset }),
    },
}));

import { signOutWithGoogle } from './auth-helper';

describe('signOutWithGoogle', () => {
    const auth = {} as Auth;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.connectedServices = ['drive', 'genai'];
        mocks.disconnect.mockResolvedValue(undefined);
        mocks.firebaseSignOut.mockResolvedValue(undefined);
        mocks.socialLogout.mockResolvedValue(undefined);
    });

    it('disconnects every known service and always signs out of Firebase', async () => {
        mocks.connectedServices = ['drive', 'unknown-service', 'genai'];
        await signOutWithGoogle(auth);
        expect(mocks.disconnect.mock.calls).toEqual([['drive'], ['genai']]);
        expect(mocks.reset).toHaveBeenCalledTimes(1);
        expect(mocks.firebaseSignOut).toHaveBeenCalledWith(auth);
    });

    it('regression: one failing disconnect does not skip the remaining services', async () => {
        mocks.disconnect.mockRejectedValueOnce(new Error('revoke failed'));
        await signOutWithGoogle(auth);
        expect(mocks.disconnect.mock.calls).toEqual([['drive'], ['genai']]);
        expect(mocks.reset).toHaveBeenCalledTimes(1);
        expect(mocks.firebaseSignOut).toHaveBeenCalledWith(auth);
    });

    it('still signs out of Firebase when the platform logout rejects', async () => {
        mocks.socialLogout.mockRejectedValueOnce(new Error('not supported'));
        await signOutWithGoogle(auth);
        expect(mocks.firebaseSignOut).toHaveBeenCalledWith(auth);
    });
});
