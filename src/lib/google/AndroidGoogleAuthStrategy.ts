import { SocialLogin } from '@capgo/capacitor-social-login';
import { getScopesForService } from './config';

export class AndroidGoogleAuthStrategy {
    private accessToken: string | null = null;
    private tokenExpiration: number | null = null;

    async connect(serviceId: string, loginHint?: string): Promise<string> {
        return this.getValidToken(serviceId, loginHint);
    }

    async getValidToken(serviceId: string, loginHint?: string): Promise<string> {
        if (this.accessToken && this.tokenExpiration && Date.now() < this.tokenExpiration) {
            return this.accessToken;
        }

        // Use SocialLogin plugin with options to support login_hint (patched plugin)
        const options: any = {
            scopes: getScopesForService(serviceId),
            style: 'bottom', // Required for autoSelectEnabled on Android
            autoSelectEnabled: true,
        };

        if (loginHint) {
            options.login_hint = loginHint;
        }

        const result = await SocialLogin.login({
            provider: 'google',
            options,
        });

        if (result.result.responseType === 'offline') {
            throw new Error('Offline mode not supported');
        }

        if (!result.result.accessToken?.token) {
            throw new Error('No access token returned from Android sign-in');
        }

        this.accessToken = result.result.accessToken.token;
        // Default Google Access Token lifetime is 1 hour (3600s).
        this.tokenExpiration = Date.now() + 50 * 60 * 1000;

        return result.result.accessToken.token;
    }

    async disconnect(serviceId: string): Promise<void> {
        if (this.accessToken) {
            try {
                // On Android/Native, logout usually clears the session state in the plugin
                await SocialLogin.logout({ provider: 'google' });
            } catch (e) {
                console.warn('Failed to logout from SocialLogin on Android', e);
            }
        }
        this.accessToken = null;
        this.tokenExpiration = null;
        void serviceId;
    }
}
