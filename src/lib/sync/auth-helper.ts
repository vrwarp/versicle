
import {
    GoogleAuthProvider,
    signInWithCredential,
    signOut as firebaseSignOut,
    type UserCredential,
    type Auth
} from 'firebase/auth';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { getFirebaseAuth } from './firebase-config';
import { googleIntegrationManager } from '../google/GoogleIntegrationManager';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';

/**
 * Sign in with Google using a hybrid approach:
 * - On Native (Android/iOS): Uses native Google Sign-In via @capgo/capacitor-social-login.
 * - On Web: Uses @capgo/capacitor-social-login (which uses GIS).
 */
export const signInWithGoogle = async (): Promise<UserCredential | undefined | void> => {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error("Firebase not initialized");
    }

    // Unite the flow if possible, or keep separate if needed for specific logic.
    // SocialLogin works on both.

    // We want the 'identity' service scopes
    // We can use googleIntegrationManager to 'connect' but that returns accessToken.
    // For Firebase Auth, we prefer idToken if available, or accessToken.

    // Let's use SocialLogin directly to get the full result
    try {
        const result = await SocialLogin.login({
            provider: 'google',
            options: {
                scopes: ['email', 'profile', 'openid'] // Standard scopes for login
            }
        });

        if (result.result.responseType === 'offline') {
            throw new Error("Offline login not supported for Firebase Auth");
        }

        const idToken = result.result.idToken;
        const accessToken = result.result.accessToken?.token;

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
 * - On Native: Signs out from Native plugin + Firebase.
 * - On Web: Signs out from Firebase.
 * - ALWAYS: Clears Google Services Store and disconnects services.
 */
export const signOutWithGoogle = async (auth: Auth): Promise<void> => {
    // 1. Disconnect all services (Revoke tokens if possible)
    try {
        const connectedServices = useGoogleServicesStore.getState().connectedServices;
        for (const serviceId of connectedServices) {
            await googleIntegrationManager.disconnectService(serviceId);
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
