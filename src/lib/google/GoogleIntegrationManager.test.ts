import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { googleIntegrationManager } from './GoogleIntegrationManager';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';

// Mock Capacitor to simulate Web platform
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false),
        getPlatform: vi.fn().mockReturnValue('web'),
    },
}));

// Mock Strategies modules to ensure they don't do anything real
vi.mock('./WebGoogleAuthStrategy');
vi.mock('./AndroidGoogleAuthStrategy');

interface MockStrategy {
    connect: Mock;
    getValidToken: Mock;
    disconnect: Mock;
}

describe('GoogleIntegrationManager', () => {
    beforeEach(() => {
        useGoogleServicesStore.getState().reset();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper to get the mocked strategy instance from the singleton
    const getMockStrategy = () => (googleIntegrationManager as unknown as { strategy: MockStrategy }).strategy;

    it('should connect service successfully on Web', async () => {
        const strategy = getMockStrategy();
        strategy.connect = vi.fn().mockResolvedValue('mock-token');

        await googleIntegrationManager.connectService('drive');

        expect(strategy.connect).toHaveBeenCalledWith('drive', undefined);
        expect(useGoogleServicesStore.getState().isServiceConnected('drive')).toBe(true);
    });

    it('should throw error if connection fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const strategy = getMockStrategy();
        strategy.connect = vi.fn().mockRejectedValue(new Error('Popup closed'));

        await expect(googleIntegrationManager.connectService('drive')).rejects.toThrow('Popup closed');
        expect(useGoogleServicesStore.getState().isServiceConnected('drive')).toBe(false);
    });

    it('should get valid token if connected', async () => {
        useGoogleServicesStore.getState().connectService('drive');
        const strategy = getMockStrategy();
        strategy.getValidToken = vi.fn().mockResolvedValue('fresh-token');

        const token = await googleIntegrationManager.getValidToken('drive');
        expect(token).toBe('fresh-token');
    });

    it('should disconnect if getting token fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        useGoogleServicesStore.getState().connectService('drive');
        const strategy = getMockStrategy();
        strategy.getValidToken = vi.fn().mockRejectedValue(new Error('Auth revoked'));
        strategy.disconnect = vi.fn();

        await expect(googleIntegrationManager.getValidToken('drive')).rejects.toThrow('Auth revoked');

        // Should have triggered disconnect
        expect(useGoogleServicesStore.getState().isServiceConnected('drive')).toBe(false);
        expect(strategy.disconnect).toHaveBeenCalledWith('drive');
    });
});
