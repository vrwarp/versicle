import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AndroidGoogleAuthStrategy } from './AndroidGoogleAuthStrategy';
import { SocialLogin } from '@capgo/capacitor-social-login';

vi.mock('@capgo/capacitor-social-login', () => ({
    SocialLogin: {
        login: vi.fn(),
        logout: vi.fn(),
    },
}));

vi.mock('./config', () => ({
    getScopesForService: vi.fn().mockReturnValue(['scope1', 'scope2']),
}));

describe('AndroidGoogleAuthStrategy', () => {
    let strategy: AndroidGoogleAuthStrategy;

    beforeEach(() => {
        vi.clearAllMocks();
        strategy = new AndroidGoogleAuthStrategy();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should call SocialLogin.login with login_hint if provided', async () => {
        const mockResult = {
            result: {
                responseType: 'online',
                accessToken: {
                    token: 'new-token',
                }
            },
        };
        (SocialLogin.login as any).mockResolvedValue(mockResult);

        const token = await strategy.getValidToken('drive', 'user@example.com');

        expect(SocialLogin.login).toHaveBeenCalledTimes(1);
        expect(SocialLogin.login).toHaveBeenCalledWith({
            provider: 'google',
            options: {
                scopes: ['scope1', 'scope2'],
                style: 'bottom',
                autoSelectEnabled: true,
                login_hint: 'user@example.com',
            },
        });
        expect(token).toBe('new-token');
    });

    it('should call SocialLogin.login and return token on first call', async () => {
        const mockResult = {
            result: {
                accessToken: {
                    token: 'mock-access-token',
                },
                responseType: 'online',
            },
        };

        vi.mocked(SocialLogin.login).mockResolvedValue(mockResult as any);

        const token = await strategy.getValidToken('test-service');

        expect(SocialLogin.login).toHaveBeenCalledTimes(1);
        expect(SocialLogin.login).toHaveBeenCalledWith({
            provider: 'google',
            options: {
                scopes: ['scope1', 'scope2'],
                style: 'bottom',
                autoSelectEnabled: true,
            },
        });
        expect(token).toBe('mock-access-token');
    });

    it('should return cached token on second call within expiration', async () => {
        const mockResult = {
            result: {
                responseType: 'online',
                accessToken: {
                    token: 'cached-token',
                }
            },
        };
        (SocialLogin.login as any).mockResolvedValue(mockResult);

        // First call
        await strategy.getValidToken('drive');

        // Second call
        const token = await strategy.getValidToken('drive');

        expect(SocialLogin.login).toHaveBeenCalledTimes(1);
        expect(token).toBe('cached-token');
    });

    it('should call SocialLogin.login again if cache expired', async () => {
        const mockResult1 = { result: { responseType: 'online', accessToken: { token: 'token-1' } } };
        const mockResult2 = { result: { responseType: 'online', accessToken: { token: 'token-2' } } };

        const loginMock = (SocialLogin.login as any);
        loginMock.mockResolvedValueOnce(mockResult1)
            .mockResolvedValueOnce(mockResult2);

        // First call
        const token1 = await strategy.getValidToken('drive');
        expect(token1).toBe('token-1');

        // Advance time by 51 minutes (expiration is 50 mins)
        vi.setSystemTime(Date.now() + 51 * 60 * 1000);

        // Second call
        const token2 = await strategy.getValidToken('drive');
        expect(token2).toBe('token-2');
        expect(SocialLogin.login).toHaveBeenCalledTimes(2);
    });

    it('should clear cache on disconnect', async () => {
        const mockResult = {
            result: {
                responseType: 'online',
                accessToken: {
                    token: 'token',
                }
            },
        };
        (SocialLogin.login as any).mockResolvedValue(mockResult);

        await strategy.getValidToken('drive');

        await strategy.disconnect('drive');

        expect(SocialLogin.logout).toHaveBeenCalledWith({ provider: 'google' });

        // Next call should hit login again
        await strategy.getValidToken('drive');
        expect(SocialLogin.login).toHaveBeenCalledTimes(2);
    });
});
