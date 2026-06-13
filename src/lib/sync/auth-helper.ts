import {
    GoogleAuthProvider,
    signInWithCredential,
    signOut as firebaseSignOut,
    type UserCredential,
    type Auth
} from 'firebase/auth';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { getFirebaseAuth } from './firebase-config';
import { getGoogleAuthClient, GOOGLE_SERVICES, type GoogleServiceId } from '@domains/google';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';

/**
 * Sign in with Google via the GoogleAuthClient's `connect('identity')`
 * (Phase 7 §G, GG-13): the client returns the FULL credential — idToken for
 * Firebase, accessToken as fallback — so this module no longer drives a
 * parallel SocialLogin.login flow with its own copy of the scope list.
 */
export const signInWithGoogle = async (): Promise<UserCredential | undefined | void> => {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error("Firebase not initialized");
    }

    try {
        const { idToken, accessToken } = await getGoogleAuthClient().connect('identity');

        if (idToken) {
            // Create Firebase credential using the Google ID Token
            const credential = GoogleAuthProvider.credential(idToken);
            return await signInWithCredential(auth, credential);
        } else if (accessToken) {
            // Fallback to access token if idToken is missing (web sometimes?)
            const credential = GoogleAuthProvider.credential(null, accessToken);
            return await signInWithCredential(auth, credential);
        } else {
            throw new Error("No tokens returned from Google Sign-In");
        }
    } catch (error) {
        console.error("Google Sign-In failed", error);
        throw error;
    }
};

/**
 * Sign out from Google:
 * - Disconnects every connected service through the GoogleAuthClient
 *   (clears cached tokens + the persisted "has connected before" hints).
 * - ALWAYS: clears the Google services store, platform sign-out, Firebase
 *   sign-out.
 */
export const signOutWithGoogle = async (auth: Auth): Promise<void> => {
    // 1. Disconnect all services (revoke tokens if possible)
    try {
        const client = getGoogleAuthClient();
        const connectedServices = useGoogleServicesStore.getState().connectedServices;
        for (const serviceId of connectedServices) {
            if (serviceId in GOOGLE_SERVICES) {
                await client.disconnect(serviceId as GoogleServiceId);
            }
        }
    } catch (e) {
        console.warn("Failed to disconnect services during signout", e);
    }

    // 2. Clear Store
    useGoogleServicesStore.getState().reset();

    // 3. Platform Sign Out
    try {
        await SocialLogin.logout({ provider: 'google' });
    } catch {
        // Ignore if already logged out or not supported
    }

    await firebaseSignOut(auth);
};
