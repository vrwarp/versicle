import { loadScript } from '../utils/script-loader';
import { getScopesForService } from './config';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';

declare global {
    interface Window {
        google?: {
            accounts: {
                oauth2: {
                    initTokenClient: (config: any) => any;
                    revoke: (token: string, callback: () => void) => void;
                };
            };
        };
    }
}

export class WebGoogleAuthStrategy {
    private tokenClient: any;
    private accessToken: string | null = null;
    private expiryTime: number = 0;

    async initialize(): Promise<void> {
        await loadScript('https://accounts.google.com/gsi/client', 'google-gsi-client');
    }

    async connect(serviceId: string, loginHint?: string): Promise<string> {
        if (!window.google) {
            await this.initialize();
        }

        const storeClientId = useGoogleServicesStore.getState().googleClientId;
        const clientId = storeClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID;

        if (!clientId) {
            throw new Error("Google Client ID not configured");
        }

        return new Promise((resolve, reject) => {
            this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: getScopesForService(serviceId).join(' '),
                callback: (response: any) => {
                    if (response.error) {
                        reject(response);
                        return;
                    }
                    this.accessToken = response.access_token;
                    this.expiryTime = Date.now() + (response.expires_in * 1000);
                    resolve(response.access_token);
                },
                login_hint: loginHint,
                prompt: 'consent', // Force consent for new connections
            });

            this.tokenClient.requestAccessToken();
        });
    }

    async getValidToken(serviceId: string): Promise<string> {
        if (this.accessToken && Date.now() < this.expiryTime - 60000) {
            return this.accessToken;
        }

        if (!window.google) {
            await this.initialize();
        }

        // Silent refresh
        return new Promise((resolve, reject) => {
            const storeClientId = useGoogleServicesStore.getState().googleClientId;
            const clientId = storeClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID;

            if (!clientId) {
                reject(new Error("Google Client ID not configured"));
                return;
            }

            // Re-initialize if necessary, though ideally we keep the client instance.
            // GIS allows creating a new client easily.
            this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: getScopesForService(serviceId).join(' '),
                callback: (response: any) => {
                    if (response.error) {
                        reject(response);
                        return;
                    }
                    this.accessToken = response.access_token;
                    this.expiryTime = Date.now() + (response.expires_in * 1000);
                    resolve(response.access_token);
                },
                prompt: '', // Attempt silent refresh
            });

            // Check if we can skip prompt
            this.tokenClient.requestAccessToken();
        });
    }

    async disconnect(): Promise<void> {
        if (this.accessToken && window.google) {
            return new Promise((resolve) => {
                window.google!.accounts.oauth2.revoke(this.accessToken!, () => {
                    this.accessToken = null;
                    this.expiryTime = 0;
                    resolve();
                });
            });
        }
        this.accessToken = null;
        this.expiryTime = 0;
    }
}
