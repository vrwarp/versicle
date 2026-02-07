import { Capacitor } from '@capacitor/core';
import { WebGoogleAuthStrategy } from './WebGoogleAuthStrategy';
import { NativeGoogleAuthStrategy } from './NativeGoogleAuthStrategy';
import { useGoogleServicesStore } from '../../store/useGoogleServicesStore';
import { useSyncStore } from '../sync/hooks/useSyncStore';

class GoogleIntegrationManager {
    private strategy: WebGoogleAuthStrategy | NativeGoogleAuthStrategy;

    constructor() {
        this.strategy = Capacitor.isNativePlatform()
            ? new NativeGoogleAuthStrategy()
            : new WebGoogleAuthStrategy();
    }

    async connectService(serviceId: string, loginHint?: string): Promise<string> {
        try {
            const token = await this.strategy.connect(serviceId, loginHint);
            useGoogleServicesStore.getState().connectService(serviceId);
            return token;
        } catch (error) {
            console.error(`Failed to connect service ${serviceId}:`, error);
            throw error;
        }
    }

    async getValidToken(serviceId: string): Promise<string> {
        // Initial check if service is 'supposed' to be connected
        if (!useGoogleServicesStore.getState().isServiceConnected(serviceId)) {
            throw new Error(`Service ${serviceId} is not connected.`);
        }

        try {
            const email = useSyncStore.getState().firebaseUserEmail;
            return await this.strategy.getValidToken(serviceId, email || undefined);
        } catch (error) {
            console.error(`Failed to get token for ${serviceId}, disconnecting...`, error);
            // Auto-disconnect on fatal auth errors (like revocation)
            this.disconnectService(serviceId);
            throw error;
        }
    }

    async disconnectService(serviceId: string): Promise<void> {
        await this.strategy.disconnect(serviceId);
        useGoogleServicesStore.getState().disconnectService(serviceId);
    }
}

export const googleIntegrationManager = new GoogleIntegrationManager();
