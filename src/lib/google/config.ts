export interface GoogleServiceConfig {
    id: string;
    name: string;
    scopes: string[];
}

export interface GoogleLoginOptions {
    scopes: string[];
    style?: 'bottom' | 'standard';
    autoSelectEnabled?: boolean;
    login_hint?: string;
}

export const GOOGLE_SERVICES: Record<string, GoogleServiceConfig> = {
    drive: {
        id: 'drive',
        name: 'Google Drive',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    },
    identity: {
        id: 'identity',
        name: 'Sign In',
        scopes: ['email', 'profile', 'openid'],
    },
};

export const getScopesForService = (serviceId: string): string[] => {
    return GOOGLE_SERVICES[serviceId]?.scopes || [];
};
