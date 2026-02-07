import { Capacitor } from '@capacitor/core';
import {
    GoogleAuthProvider,
    signInWithCredential,
    signOut as firebaseSignOut,
    type UserCredential,
    type Auth
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getFirebaseAuth } from './firebase-config';
import { googleIntegrationManager } from '../google/GoogleIntegrationManager';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';

/**
 * Sign in with Google using a hybrid approach:
 * - On Native (Android/iOS): Uses native Google Sign-In via @capacitor-firebase/authentication.
 * - On Web: Uses Google Identity Services (GIS) popup flow to get ID token, then sign in with credential.
 */
export const signInWithGoogle = async (): Promise<UserCredential | undefined | void> => {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error("Firebase not initialized");
    }

    // 1. Android / iOS Native Flow
    if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;

        if (!idToken) {
            throw new Error("No ID token returned from native sign-in");
        }

        const credential = GoogleAuthProvider.credential(idToken);
        return await signInWithCredential(auth, credential);
    }

    // 2. Web / PWA Flow
    else {
        // Use GIS-first approach: Get Access Token from Google, then sign into Firebase.
        // This ensures consistent token management and avoids popup conflicts.
        try {
            // "Connect" to identity service to get a fresh access token
            // We use the 'identity' service config (openid, email, profile)
            const accessToken = await googleIntegrationManager.connectService('identity');

            if (!accessToken) {
                throw new Error("Failed to obtain access token from Google");
            }

            // Create Firebase credential using the Google Access Token
            const credential = GoogleAuthProvider.credential(null, accessToken);

            // Sign in to Firebase with the credential
            // We use 'signInWithCredential' because we already have the proof of identity
            return await signInWithCredential(auth, credential);

        } catch (error) {
            console.error("GIS Sign-In failed", error);
            throw error;
        }
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
    // We iterate known services or just 'drive'
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
    if (Capacitor.isNativePlatform()) {
        await FirebaseAuthentication.signOut();
    }
    await firebaseSignOut(auth);
};
