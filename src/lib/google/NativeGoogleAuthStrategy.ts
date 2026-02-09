import { SocialLogin } from '@capgo/capacitor-social-login';
import { getScopesForService } from './config';

export class NativeGoogleAuthStrategy {

    private accessToken: string | null = null;
    private tokenExpiration: number | null = null;

    async connect(serviceId: string): Promise<string> {
        return this.getValidToken(serviceId);
    }

    async getValidToken(serviceId: string, loginHint?: string): Promise<string> {
        // Check if we have a valid cached token
        if (this.accessToken && this.tokenExpiration && Date.now() < this.tokenExpiration) {
            return this.accessToken;
        }

        void loginHint; // Suppress unused variable

        // Use SocialLogin plugin
        const result = await SocialLogin.login({
            provider: 'google',
            options: {
                scopes: getScopesForService(serviceId)
            }
        });

        if (result.result.responseType === 'offline') {
            throw new Error('Offline mode not supported');
        }

        if (!result.result.accessToken?.token) {
            throw new Error('No access token returned from native sign-in');
        }

        this.accessToken = result.result.accessToken.token;
        // Default Google Access Token lifetime is 1 hour (3600s). We use 50 minutes to be safe.
        // The token object might have `expires` but it is a string? "2024-..."
        // Safe assumption or we can check `result.result.idToken` if we need to decode.
        this.tokenExpiration = Date.now() + 50 * 60 * 1000;

        return result.result.accessToken.token;
    }

    async disconnect(serviceId: string): Promise<void> {
        // Clear cached token
        this.accessToken = null;
        this.tokenExpiration = null;

        // On native, 'disconnecting' a specific service is tricky.
        // Usually involves signing out completely or just revoking scopes which is complex.
        // For now, we might just clear local state in the app, 
        // as actual revocation happens via Google Account settings.
        // We will just return.
        void serviceId; // Suppress unused variable warning
        return;
    }
}
