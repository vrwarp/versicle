import { describe, it, expect, beforeEach } from 'vitest';
import { useGoogleServicesStore } from './useGoogleServicesStore';

describe('useGoogleServicesStore', () => {
    beforeEach(() => {
        useGoogleServicesStore.getState().reset();
    });

    it('should initially have no connected services', () => {
        expect(useGoogleServicesStore.getState().connectedServices).toEqual([]);
    });

    it('should connect a service', () => {
        useGoogleServicesStore.getState().connectService('drive');
        expect(useGoogleServicesStore.getState().connectedServices).toContain('drive');
        expect(useGoogleServicesStore.getState().isServiceConnected('drive')).toBe(true);
    });

    it('should not duplicate connected services', () => {
        useGoogleServicesStore.getState().connectService('drive');
        useGoogleServicesStore.getState().connectService('drive');
        expect(useGoogleServicesStore.getState().connectedServices).toHaveLength(1);
    });

    it('should disconnect a service', () => {
        useGoogleServicesStore.getState().connectService('drive');
        useGoogleServicesStore.getState().disconnectService('drive');
        expect(useGoogleServicesStore.getState().connectedServices).not.toContain('drive');
        expect(useGoogleServicesStore.getState().isServiceConnected('drive')).toBe(false);
    });

    it('should reset all services', () => {
        useGoogleServicesStore.getState().connectService('drive');
        useGoogleServicesStore.getState().connectService('youtube');
        useGoogleServicesStore.getState().reset();
        expect(useGoogleServicesStore.getState().connectedServices).toEqual([]);
    });
});
