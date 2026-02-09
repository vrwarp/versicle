import { SocialLogin } from '@capgo/capacitor-social-login';
import { getScopesForService } from './config';


export class WebGoogleAuthStrategy {
    private accessToken: string | null = null;
    private tokenExpiration: number | null = null;

    async initialize(): Promise<void> {
        // Initialization is handled in main.tsx, but we could double check or re-init if needed.
        // For now, assuming main.tsx handles it.
        return Promise.resolve();
    }

    async connect(serviceId: string, loginHint?: string): Promise<string> {
        return this.getValidToken(serviceId, loginHint);
    }

    async getValidToken(serviceId: string, loginHint?: string): Promise<string> {
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
            throw new Error('No access token returned from web sign-in');
        }

        this.accessToken = result.result.accessToken.token;
        // Default Google Access Token lifetime is 1 hour (3600s).
        this.tokenExpiration = Date.now() + 50 * 60 * 1000;

        return result.result.accessToken.token;
    }

    async disconnect(): Promise<void> {
        if (this.accessToken) {
            try {
                await SocialLogin.logout({ provider: 'google' });
            } catch (e) {
                console.warn('Failed to logout from SocialLogin', e);
            }
        }
        this.accessToken = null;
        this.tokenExpiration = null;
    }
}
