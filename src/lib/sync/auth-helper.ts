import { Capacitor } from '@capacitor/core';
import {
    GoogleAuthProvider,
    signInWithCredential,
    signInWithRedirect,
    signOut as firebaseSignOut,
    type UserCredential,
    type Auth
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getFirebaseAuth, getGoogleProvider } from './firebase-config';

/**
 * Sign in with Google using a hybrid approach:
 * - On Native (Android/iOS): Uses native Google Sign-In via @capacitor-firebase/authentication.
 * - On Web: Uses standard Firebase JS SDK signInWithRedirect.
 */
export const signInWithGoogle = async (): Promise<UserCredential | undefined | void> => {
    const auth = getFirebaseAuth();
    const provider = getGoogleProvider();

    if (!auth || !provider) {
        throw new Error("Firebase not initialized");
    }

    // 1. Android / iOS Native Flow
    if (Capacitor.isNativePlatform()) {
        // This triggers the native Google login prompt
        const result = await FirebaseAuthentication.signInWithGoogle();

        // The native plugin returns an ID token
        const idToken = result.credential?.idToken;

        if (!idToken) {
            throw new Error("No ID token returned from native sign-in");
        }

        // Convert the native token into a credential the JS SDK can understand
        const credential = GoogleAuthProvider.credential(idToken);

        // Sign in the JS SDK with that credential.
        // This syncs the auth state to your existing `auth` instance.
        return await signInWithCredential(auth, credential);
    }

    // 2. Web / PWA Flow
    else {
        await signInWithRedirect(auth, provider);
        return;
    }
};

/**
 * Sign out from Google using a hybrid approach:
 * - On Native (Android/iOS): Signs out from both Native and Firebase JS SDK.
 * - On Web: Signs out from Firebase JS SDK.
 */
export const signOutWithGoogle = async (auth: Auth): Promise<void> => {
    if (Capacitor.isNativePlatform()) {
        await FirebaseAuthentication.signOut();
    }
    await firebaseSignOut(auth);
};
