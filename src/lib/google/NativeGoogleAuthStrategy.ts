import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getScopesForService } from './config';

export class NativeGoogleAuthStrategy {

    async connect(serviceId: string): Promise<string> {
        return this.getValidToken(serviceId);
    }

    async getValidToken(serviceId: string): Promise<string> {
        // Native plugin handles checking refresh token automatically.
        // Requesting scopes incrementally adds them to the user session.
        const result = await FirebaseAuthentication.signInWithGoogle({
            scopes: getScopesForService(serviceId),
            // The plugin might not need this explicitly if already signed in,
            // but explicit scope request ensures we have the permissions.
        });

        // The token returned here is the ID Token usually, we might need an access token for Drive.
        // The plugin's `credential` object contains `accessToken` on iOS/Android if requested.
        // Let's check the type definition or behavior. typically `authentication` plugin returns `idToken`.
        // However, for Drive API calls we need an OAuth2 Access Token. 
        // The plugin documentation says: `accessToken` is available in `credential`.

        if (!result.credential?.accessToken) {
            throw new Error('No access token returned from native sign-in');
        }

        return result.credential.accessToken;
    }

    async disconnect(serviceId: string): Promise<void> {
        // On native, 'disconnecting' a specific service is tricky.
        // Usually involves signing out completely or just revoking scopes which is complex.
        // For now, we might just clear local state in the app, 
        // as actual revocation happens via Google Account settings.
        // We will just return.
        void serviceId; // Suppress unused variable warning
        return;
    }
}
