import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NativeGoogleAuthStrategy } from './NativeGoogleAuthStrategy';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

vi.mock('@capacitor-firebase/authentication', () => ({
    FirebaseAuthentication: {
        signInWithGoogle: vi.fn(),
    },
}));

vi.mock('./config', () => ({
    getScopesForService: vi.fn().mockReturnValue(['scope1', 'scope2']),
}));

describe('NativeGoogleAuthStrategy', () => {
    let strategy: NativeGoogleAuthStrategy;

    beforeEach(() => {
        vi.clearAllMocks();
        strategy = new NativeGoogleAuthStrategy();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should call signInWithGoogle and return token on first call', async () => {
        const mockResult = {
            credential: {
                accessToken: 'new-token',
            },
        };
        (FirebaseAuthentication.signInWithGoogle as any).mockResolvedValue(mockResult);

        const token = await strategy.getValidToken('drive');

        expect(FirebaseAuthentication.signInWithGoogle).toHaveBeenCalledTimes(1);
        expect(token).toBe('new-token');
    });

    it('should return cached token on second call within expiration', async () => {
        const mockResult = {
            credential: {
                accessToken: 'cached-token',
            },
        };
        (FirebaseAuthentication.signInWithGoogle as any).mockResolvedValue(mockResult);

        // First call
        await strategy.getValidToken('drive');

        // Second call
        const token = await strategy.getValidToken('drive');

        expect(FirebaseAuthentication.signInWithGoogle).toHaveBeenCalledTimes(1);
        expect(token).toBe('cached-token');
    });

    it('should call signInWithGoogle again if cache expired', async () => {
        const mockResult1 = { credential: { accessToken: 'token-1' } };
        const mockResult2 = { credential: { accessToken: 'token-2' } };

        const signInMock = (FirebaseAuthentication.signInWithGoogle as any);
        signInMock.mockResolvedValueOnce(mockResult1)
            .mockResolvedValueOnce(mockResult2);

        // First call
        const token1 = await strategy.getValidToken('drive');
        expect(token1).toBe('token-1');

        // Advance time by 51 minutes (expiration is 50 mins)
        vi.setSystemTime(Date.now() + 51 * 60 * 1000);

        // Second call
        const token2 = await strategy.getValidToken('drive');
        expect(token2).toBe('token-2');
        expect(FirebaseAuthentication.signInWithGoogle).toHaveBeenCalledTimes(2);
    });

    it('should clear cache on disconnect', async () => {
        const mockResult = {
            credential: {
                accessToken: 'token',
            },
        };
        (FirebaseAuthentication.signInWithGoogle as any).mockResolvedValue(mockResult);

        await strategy.getValidToken('drive');

        // Verify it's cached
        await strategy.getValidToken('drive');
        expect(FirebaseAuthentication.signInWithGoogle).toHaveBeenCalledTimes(1);

        await strategy.disconnect('drive');

        // Should call again after disconnect
        await strategy.getValidToken('drive');
        expect(FirebaseAuthentication.signInWithGoogle).toHaveBeenCalledTimes(2);
    });
});
