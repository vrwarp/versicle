import { BaseModel } from './BaseModel';

export class RegistryModel extends BaseModel {
    // Currently no DBService methods for Registry.
    // It seems to be inferred from legacy sync logic (SyncOrchestrator).
    // For Phase 1 Wrapper, we might need to expose methods to interact with "deviceRegistry" store
    // if it exists in IndexedDB, or localStorage.

    // Looking at SyncOrchestrator, it seems to handle registry.
    // But DBService doesn't expose it.

    // I will leave this empty for now or add placeholders if I find usages.
    async getRegistry() {
        // Placeholder
        return [];
    }
}

export const registryModel = new RegistryModel();
